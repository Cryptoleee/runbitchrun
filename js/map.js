import { MAPBOX_TOKEN } from './config.js';

const DARK_STYLE = 'mapbox://styles/mapbox/dark-v11';
const ROUTE_COLOR = '#B8FF00';
const ROUTE_WIDTH = 4;

let map = null;
let positionMarker = null;
let routeSegments = null;

// ---------------------------------------------------------------------------
// Live map
// ---------------------------------------------------------------------------

export function initLiveMap(containerId, startLat, startLng) {
  mapboxgl.accessToken = MAPBOX_TOKEN;

  map = new mapboxgl.Map({
    container: containerId,
    style: DARK_STYLE,
    center: [startLng, startLat],
    zoom: 15,
    attributionControl: false,
    interactive: true
  });

  // Pulsing marker element
  const el = document.createElement('div');
  el.className = 'pulse-marker';

  const dot = document.createElement('div');
  dot.className = 'pulse-dot';
  el.appendChild(dot);

  const ring = document.createElement('div');
  ring.className = 'pulse-ring';
  el.appendChild(ring);

  positionMarker = new mapboxgl.Marker({ element: el })
    .setLngLat([startLng, startLat])
    .addTo(map);

  routeSegments = {};

  map.on('load', () => {
    map.addSource('route', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] }
    });

    map.addLayer({
      id: 'route-line',
      type: 'line',
      source: 'route',
      layout: {
        'line-join': 'round',
        'line-cap': 'round'
      },
      paint: {
        'line-color': ROUTE_COLOR,
        'line-width': ROUTE_WIDTH,
        'line-opacity': 0.9
      }
    });
  });
}

export function updateLiveMap(lat, lng, segment) {
  if (!map) return;

  positionMarker.setLngLat([lng, lat]);

  if (!routeSegments[segment]) {
    routeSegments[segment] = [];
  }
  routeSegments[segment].push([lng, lat]);

  const features = Object.keys(routeSegments).map(key => ({
    type: 'Feature',
    geometry: {
      type: 'LineString',
      coordinates: routeSegments[key]
    }
  }));

  const source = map.getSource('route');
  if (source) {
    source.setData({ type: 'FeatureCollection', features });
  }

  map.panTo([lng, lat], { duration: 500 });
}

export function destroyLiveMap() {
  if (map) {
    map.remove();
    map = null;
  }
  positionMarker = null;
  routeSegments = null;
}

// ---------------------------------------------------------------------------
// Static map (for run detail view)
// ---------------------------------------------------------------------------

export function initStaticMap(containerId, route) {
  mapboxgl.accessToken = MAPBOX_TOKEN;

  // Compute bounds from route
  const bounds = new mapboxgl.LngLatBounds();
  route.forEach(pt => bounds.extend([pt.lng, pt.lat]));

  const staticMap = new mapboxgl.Map({
    container: containerId,
    style: DARK_STYLE,
    bounds: bounds,
    fitBoundsOptions: { padding: 40 },
    attributionControl: false,
    interactive: false
  });

  staticMap.on('load', () => {
    // Group points by segment
    const segments = {};
    route.forEach(pt => {
      const seg = pt.segment || 0;
      if (!segments[seg]) segments[seg] = [];
      segments[seg].push([pt.lng, pt.lat]);
    });

    const features = Object.keys(segments).map(key => ({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: segments[key]
      }
    }));

    staticMap.addSource('route', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features }
    });

    staticMap.addLayer({
      id: 'route-line',
      type: 'line',
      source: 'route',
      layout: {
        'line-join': 'round',
        'line-cap': 'round'
      },
      paint: {
        'line-color': ROUTE_COLOR,
        'line-width': ROUTE_WIDTH,
        'line-opacity': 0.9
      }
    });

    // Start marker (green)
    if (route.length > 0) {
      const start = route[0];
      new mapboxgl.Marker({ color: '#00FF00' })
        .setLngLat([start.lng, start.lat])
        .addTo(staticMap);
    }

    // End marker (red)
    if (route.length > 1) {
      const end = route[route.length - 1];
      new mapboxgl.Marker({ color: '#FF0000' })
        .setLngLat([end.lng, end.lat])
        .addTo(staticMap);
    }
  });

  return staticMap;
}

// ---------------------------------------------------------------------------
// Static Image snapshot URL
// ---------------------------------------------------------------------------

export function getMapSnapshotUrl(route) {
  if (!route || route.length < 2) return '';

  const simplified = simplifyRoute(route, 100);

  const geojson = {
    type: 'LineString',
    coordinates: simplified.map(pt => [pt.lng, pt.lat]),
    properties: {
      stroke: ROUTE_COLOR,
      'stroke-width': 3
    }
  };

  // Mapbox Static Images API expects GeoJSON as a Feature for styling props
  const feature = {
    type: 'Feature',
    properties: {
      stroke: ROUTE_COLOR,
      'stroke-width': 3
    },
    geometry: {
      type: 'LineString',
      coordinates: simplified.map(pt => [pt.lng, pt.lat])
    }
  };

  const encoded = encodeURIComponent(JSON.stringify(feature));

  return `https://api.mapbox.com/styles/v1/mapbox/dark-v11/static/geojson(${encoded})/auto/600x300@2x?access_token=${MAPBOX_TOKEN}`;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function simplifyRoute(route, maxPoints) {
  if (route.length <= maxPoints) return route;

  const step = Math.floor(route.length / maxPoints);
  const result = [];

  for (let i = 0; i < route.length; i += step) {
    result.push(route[i]);
    if (result.length >= maxPoints - 1) break;
  }

  // Always include the last point
  const last = route[route.length - 1];
  if (result[result.length - 1] !== last) {
    result.push(last);
  }

  return result;
}
