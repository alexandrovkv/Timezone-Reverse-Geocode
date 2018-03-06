/* -*- Mode: C; c-basic-offset: 4; -*-
 *
 * Time zone lookup.
 * gcc -Wall -W json.c tz_lookup_1.c -o tz_lookup_1 -lm
 *
 * $Id$
 *
 * $Log:
 *
 */

char *tz_lookup_1_c_cvsid =
    "$Id$";

/**
 * @file tz_lookup_1.c Time zone lookup utility implementation.
 */


#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <assert.h>
#include <string.h>
#include <time.h>
#include <errno.h>
#include <sys/types.h>
#include <sys/stat.h>
#include <sys/mman.h>
#include <dirent.h>
#include <fcntl.h>

#include "json.h"



typedef struct tz_data_o * tz_data_t;
typedef struct dst_rules_o * dst_rules_t;


struct tz_data_o {
    char        * name;
    dst_rules_t   dst_rules;
};

struct dst_rules_o {
    int       nentries;
    char   ** abbrs;
    int     * offsets;
    time_t  * change;
};


static int tz_lookup( void );
static int get_files( const char * path, char *** files, int * nfiles );
static int check_file( const char * file );
static json_value * parse_file( const char * file );
static json_value * get_tz( json_value * root );
static int check_boundary( json_value * bbox );
static tz_data_t get_tz_data( json_value * tz );
static dst_rules_t get_dst_rules( json_value * dst_rules );
static tz_data_t get_etc_gmt_tz_data( double longitude );
static void tz_data_free( tz_data_t tz_data );
static json_value * get_object_item( json_value * object, const char * name );

static int point_in_multipoligon( json_value * multipolygon,
				  double latitude,
				  double longitude );
static int point_in_poligon( json_value * polygon,
			     double latitude,
			     double longitude );
static int point_in_ring( json_value * line,
			  double latitude,
			  double longitude );


static char   * opt_base_dir  = "out";
static double   opt_latitude  = 0.;
static double   opt_longitude = 0.;



int main( int argc, char ** argv )
{
    if( argc < 3 ) {
	fprintf( stderr, "usage: %s <latitude> <longitude>\n", argv[0] );
	return 1;
    }

    opt_latitude = atof( argv[1] );
    opt_longitude = atof( argv[2] );

    return tz_lookup() ? 0 : 1;
}


static int tz_lookup( void )
{
    char dir[PATH_MAX];
    char **files = NULL;
    int i, nfiles = 0;
    tz_data_t tz_data = NULL;

    if( opt_latitude >= 0 )
	snprintf( dir, sizeof( dir ), "%s/%s", opt_base_dir, "N" );
    else
	snprintf( dir, sizeof( dir ), "%s/%s", opt_base_dir, "S" );

    if( opt_longitude >= 0 )
	snprintf( dir + strlen( dir ), sizeof( dir ), "/%s", "E" );
    else
	snprintf( dir + strlen( dir ), sizeof( dir ), "/%s", "W" );

    if( !get_files( dir, &files, &nfiles ) ) {
	tz_data = get_etc_gmt_tz_data( opt_longitude );
	tz_data_free( tz_data );
	return 0;
    }

    if( nfiles == 0 ) {
	tz_data = get_etc_gmt_tz_data( opt_longitude );
	tz_data_free( tz_data );
	return 0;
    }

    for( i = 0; i < nfiles; i++ ) {
	char *file = files[i];
	json_value *root, *tz;
	fprintf( stderr, "%s\n", file );

	root = parse_file( file );
	tz = get_tz( root );

	if( tz )
	    tz_data = get_tz_data( tz );

	json_value_free( root );

	if( tz_data )
	    break;
    }

    while( nfiles-- )
	free( files[nfiles] );
    free( files );

    if( !tz_data ) {
	tz_data = get_etc_gmt_tz_data( opt_longitude );
	tz_data_free( tz_data );
	return 0;
    }

    tz_data_free( tz_data );

    return 1;
}

static int get_files( const char * path, char *** files, int * nfiles )
{
    DIR *dir;
    struct dirent *de;
    char full_name[PATH_MAX];
    char **f = NULL;
    int n = 0;

    dir = opendir( path );
    if( !dir ) {
        fprintf( stderr, "can not open '%s': %s\n",
                 path, strerror( errno ) );
        return 0;
    }

    while( ( de = readdir( dir ) ) != NULL ) {
        if( de->d_name[0] == '.' ||
            de->d_type != DT_REG )
            continue;

	if( check_file( de->d_name ) ) {
	    snprintf( full_name, sizeof( full_name ),
		      path[strlen( path ) - 1] == '/' ?
		      "%s%s" : "%s/%s",
		      path, de->d_name );

	    f = realloc( f, ++n * sizeof( char * ) );
	    f[n - 1] = strdup( full_name );
	}
    }

    closedir( dir );

    if( files )
	*files = f;
    if( nfiles )
	*nfiles = n;

    return 1;
}

static int check_file( const char * file )
{
    char minLngH, minLatH, maxLngH, maxLatH;
    int minLng, minLat, maxLng, maxLat;

    sscanf( file, "%c%d%c%d%c%d%c%d",
	    &minLngH, &minLng,
	    &minLatH, &minLat,
	    &maxLngH, &maxLng,
	    &maxLatH, &maxLat );

    if( minLngH == 'W' )
	minLng = -minLng;
    if( minLatH == 'S' )
	minLat = -minLat;
    if( maxLngH == 'W' )
	maxLng = -maxLng;
    if( maxLatH == 'S' )
	maxLat = -maxLat;

    return ( ( int )opt_latitude >= minLat &&
	     ( int )opt_latitude <= maxLat &&
	     ( int )opt_longitude >= minLng &&
	     ( int )opt_longitude <= maxLng );
}

static json_value * parse_file( const char * file )
{
    int fd;
    void *data;
    size_t size;
    json_value *root;

    fd = open( file, O_RDONLY, 0 );
    if( fd == -1 ) {
	fprintf( stderr, "%s: can not open '%s': %s\n",
		 __FUNCTION__, file, strerror( errno ) );
	return NULL;
    }

    size = lseek( fd, 0, SEEK_END );
    lseek( fd, 0, SEEK_SET );

    data = mmap( NULL, size, PROT_READ, MAP_SHARED, fd, 0 );
    if( data == MAP_FAILED ) {
	fprintf( stderr, "%s: can not map '%s': %s\n",
		 __FUNCTION__, file, strerror( errno ) );
	close( fd );
	return NULL;
    }

    close( fd );

    root = json_parse( data, size );

    munmap( data, size );

    return root;
}

static json_value * get_tz( json_value * root )
{
    json_value *type, *coordinates, *bbox;

    bbox = get_object_item( root, "bbox" );

    if( !check_boundary( bbox ) )
	return NULL;
    fprintf( stderr, "inside bbox\n" );

    type = get_object_item( root, "type" );
    coordinates = get_object_item( root, "coordinates" );

    if( !strcasecmp( type->u.string.ptr, "multipolygon" ) ) {
	if( point_in_multipoligon( coordinates, opt_latitude, opt_longitude ) )
	    return get_object_item( root, "tz" );
    } else if( !strcasecmp( type->u.string.ptr, "polygon" ) ) {
	if( point_in_poligon( coordinates, opt_latitude, opt_longitude ) )
	    return get_object_item( root, "tz" );
    } else {
	fprintf( stderr, "%s: unsupported geometry type: %s\n",
		 __FUNCTION__, type->u.string.ptr );
    }

    return NULL;
}

static int check_boundary( json_value * bbox )
{
    int size;

    size = bbox->u.array.length;
    if( size != 4 ) {
        fprintf( stderr, "%s: invalid bbox size: %d\n",
                 __FUNCTION__, size );
	return 0;
    }

    return ( opt_latitude >= bbox->u.array.values[1]->u.dbl &&
	     opt_latitude <= bbox->u.array.values[3]->u.dbl &&
	     opt_longitude >= bbox->u.array.values[0]->u.dbl &&
	     opt_longitude <= bbox->u.array.values[2]->u.dbl );
}

static tz_data_t get_tz_data( json_value * tz )
{
    tz_data_t tz_data;
    json_value *name, *dst_rules;

    name = get_object_item( tz, "name" );
    dst_rules = get_object_item( tz, "dstRules" );

    tz_data = malloc( sizeof( *tz_data ) );
    if( !tz_data )
        return NULL;

    fprintf( stderr, "found time zone: %s", name->u.string.ptr );

    tz_data->name = strdup( name->u.string.ptr );
    tz_data->dst_rules = get_dst_rules( dst_rules );

    return tz_data;
}

static dst_rules_t get_dst_rules( json_value * dst_rules )
{
    dst_rules_t dst;
    json_value *abbrs, *offsets, *change;
    size_t i, size;

    dst = malloc( sizeof( *dst ) );
    if( !dst )
        return NULL;

    dst->nentries = 0;
    dst->abbrs = NULL;
    dst->offsets = NULL;
    dst->change = NULL;

    abbrs = get_object_item( dst_rules, "abbrs" );
    offsets = get_object_item( dst_rules, "offsets" );
    change = get_object_item( dst_rules, "change" );

    size = abbrs->u.array.length;
    fprintf( stderr, ",  [" );
    for( i = 0; i < size; i++ ) {
	json_value *abbr;

	abbr = abbrs->u.array.values[i];
	dst->abbrs = realloc( dst->abbrs, ++dst->nentries * sizeof( char * ) );
	dst->abbrs[i] = strdup( abbr->u.string.ptr );

	fprintf( stderr, " %s", dst->abbrs[i] );
    }
    fprintf( stderr, " ]" );

    size = offsets->u.array.length;
    fprintf( stderr, ",  [" );
    for( i = 0; i < size; i++ ) {
	json_value *offset;

	offset = offsets->u.array.values[i];
	dst->offsets = realloc( dst->offsets, ( i + 1 ) * sizeof( int * ) );
	dst->offsets[i] = offset->u.integer;

	fprintf( stderr, " %d", dst->offsets[i] );
    }
    fprintf( stderr, " ]" );

    size = change->u.array.length;
    fprintf( stderr, ",  [" );
    for( i = 0; i < size; i++ ) {
	json_value *chng;

	chng = change->u.array.values[i];
	dst->change = realloc( dst->change, ( i + 1 ) * sizeof( time_t * ) );
	dst->change[i] = chng->u.integer;

	char *time_str = ctime( &dst->change[i] );
	time_str[strlen( time_str ) - 1] = '\0';
	fprintf( stderr, " %lu (%s)",
		 dst->change[i], time_str );
    }
    fprintf( stderr, " ]\n" );

    return dst;
}

static tz_data_t get_etc_gmt_tz_data( double longitude )
{
    tz_data_t tz_data;
    dst_rules_t dst;
    double lng = longitude;
    char sign = '-';
    int tz;
    char name[16];

    tz_data = malloc( sizeof( *tz_data ) );
    if( !tz_data )
        return NULL;

    dst = malloc( sizeof( *dst ) );
    if( !dst ) {
	free( tz_data );
        return NULL;
    }

    dst->nentries = 1;
    dst->abbrs = NULL;
    dst->offsets = NULL;
    dst->change = NULL;

    if( longitude < 0. ) {
	lng = -longitude;
	sign = '+';
    }

    tz = ( int )( ( lng - 7.5 ) / 15. + 1. );

    snprintf( name, sizeof( name ), "Etc/GMT%c%d", sign, tz );

    tz_data->name = strdup( name );
    dst->abbrs = realloc( dst->abbrs, sizeof( char * ) );
    dst->abbrs[0] = strdup( name );
    dst->offsets = realloc( dst->offsets, sizeof( int * ) );
    dst->offsets[0] = tz * ( sign == '-' ? 3600 : -3600 );
    tz_data->dst_rules = dst;

    fprintf( stderr, "%s, %d\n", tz_data->name, dst->offsets[0] );

    return tz_data;
}

static void tz_data_free( tz_data_t tz_data )
{
    if( !tz_data )
	return;

    while( tz_data->dst_rules->nentries-- )
	free( tz_data->dst_rules->abbrs[tz_data->dst_rules->nentries] );

    free( tz_data->dst_rules->abbrs );
    free( tz_data->dst_rules->offsets );
    free( tz_data->dst_rules->change );
    free( tz_data->dst_rules );

    free( tz_data->name );
    free( tz_data );
}

static json_value * get_object_item( json_value * object, const char * name )
{
    size_t i, size;

    size = object->u.object.length;

    for( i = 0; i < size; i++ ) {
	json_object_entry cur;

	cur = object->u.object.values[i];

	if( !strcmp( cur.name, name ) )
	    return cur.value;
    }

    return NULL;
}


static int point_in_multipoligon( json_value * multipolygon,
				  double latitude,
				  double longitude )
{
    size_t i, size;
    int inside = 0;

    size = multipolygon->u.array.length;

    for( i = 0; i < size && !inside; i++ ) {
	json_value * polygon = multipolygon->u.array.values[i];

	inside = point_in_poligon( polygon, latitude, longitude );
    }

    return inside;
}

static int point_in_poligon( json_value * polygon,
			     double latitude,
			     double longitude )
{
    int inside = 0;
    size_t size = polygon->u.array.length;
    json_value * line = polygon->u.array.values[0];

    if( point_in_ring( line, latitude, longitude ) ) {
	size_t k = 1;
	int in_hole = 0;

	while( k < size && !in_hole ) {
	    line = polygon->u.array.values[k];

	    if( point_in_ring( line, latitude, longitude ) )
		in_hole = 1;

	    k++;
	}

	if( !in_hole )
	    inside = 1;
    }

    return inside;
}

static int point_in_ring( json_value * line,
			  double latitude,
			  double longitude )
{
    int inside = 0;
    size_t i, j, size;

    size = line->u.array.length;

    for( i = 0, j = size - 1; i < size; j = i++ ) {
	json_value * pi = line->u.array.values[i];
	json_value * pj = line->u.array.values[j];
	double xi = pi->u.array.values[0]->u.dbl, yi = pi->u.array.values[1]->u.dbl;
	double xj = pj->u.array.values[0]->u.dbl, yj = pj->u.array.values[1]->u.dbl;

	if( ((yi > latitude) != (yj > latitude)) &&
            (longitude < (xj - xi) * (latitude - yi) / (yj - yi) + xi) )
	    inside = !inside;
    }

    return inside;
}

