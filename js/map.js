import { MAPBOX_TOKEN } from './config.js';

const DARK_STYLE = 'mapbox://styles/mapbox/dark-v11';
const ROUTE_COLOR = '#B8FF00';
const ROUTE_WIDTH = 4;

// ---------------------------------------------------------------------------
// Static map (for summary + detail views)
// ---------------------------------------------------------------------------

export function initStaticMap(containerId, route) {
  mapboxgl.accessToken = MAPBOX_TOKEN;

  if (!route || route.length < 2) return null;

  // Compute bounds from route
  const bounds = new mapboxgl.LngLatBounds();
  route.forEach(pt => bounds.extend([pt.lng, pt.lat]));

  const staticMap = new mapboxgl.Map({
    container: containerId,
    style: DARK_STYLE,
    bounds: bounds,
    fitBoundsOptions: { padding: 50 },
    attributionControl: false,
    interactive: false
  });

  // Force resize after a tick to handle container layout timing
  requestAnimationFrame(() => staticMap.resize());

  function addRouteLayer() {
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

    console.log('[map] Route points:', route.length, 'Segments:', Object.keys(segments).length, 'First point:', route[0]);

    if (staticMap.getSource('route')) return; // already added

    staticMap.addSource('route', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features }
    });

    // Route glow (wider, semi-transparent behind the main line)
    staticMap.addLayer({
      id: 'route-glow',
      type: 'line',
      source: 'route',
      layout: {
        'line-join': 'round',
        'line-cap': 'round'
      },
      paint: {
        'line-color': ROUTE_COLOR,
        'line-width': 10,
        'line-opacity': 0.15
      }
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

    // Start marker (lime dot)
    if (route.length > 0) {
      const start = route[0];
      const startEl = document.createElement('div');
      startEl.style.cssText = 'width:14px;height:14px;background:#B8FF00;border-radius:50%;border:2px solid #0e0e0e;box-shadow:0 0 8px rgba(184,255,0,0.5);';
      new mapboxgl.Marker({ element: startEl })
        .setLngLat([start.lng, start.lat])
        .addTo(staticMap);
    }

    // End marker (white dot)
    if (route.length > 1) {
      const end = route[route.length - 1];
      const endEl = document.createElement('div');
      endEl.style.cssText = 'width:14px;height:14px;background:#ffffff;border-radius:50%;border:2px solid #0e0e0e;box-shadow:0 0 8px rgba(255,255,255,0.4);';
      new mapboxgl.Marker({ element: endEl })
        .setLngLat([end.lng, end.lat])
        .addTo(staticMap);
    }

    // Fit bounds after route is added
    staticMap.fitBounds(bounds, { padding: 50 });
  }

  // Use both load and idle events for reliability
  if (staticMap.isStyleLoaded()) {
    addRouteLayer();
  } else {
    staticMap.on('load', addRouteLayer);
  }

  return staticMap;
}

// ---------------------------------------------------------------------------
// Static Image snapshot URL (for feed cards)
// ---------------------------------------------------------------------------

export function getMapSnapshotUrl(route) {
  if (!route || route.length < 2) return '';

  const simplified = simplifyRoute(route, 100);

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
