import { Component, Element, Listen, Prop, State, Watch } from '@stencil/core';

import {
  control as Lcontrol,
  latLng as LlatLng,
  latLngBounds as LlatLngBounds,
  icon as Licon,
  layerGroup as LlayerGroup,
  map as Lmap,
  marker as Lmarker,
  Control as LeafletControl,
  LayerGroup as LeafletLayerGroup,
  LeafletEvent,
  Map as LeafletMap,
  Path as LeafletPath,
} from 'leaflet';

import {
  FeatureLayer,
  basemapLayer,
  featureLayer,
  tiledMapLayer,
} from 'esri-leaflet';

import { geosearch, GeosearchControl } from 'esri-leaflet-geocoder';

const DEFAULT_BASEMAP_URL =
  'https://awsgeo.boston.gov/arcgis/rest/services/Basemaps/BostonCityBasemap_WM/MapServer';

const BOSTON_BOUNDS = LlatLngBounds(
  LlatLng(42.170274, -71.348648),
  LlatLng(42.456141, -70.818901)
);

const WAYPOINT_ICON = Licon({
  iconUrl: '/images/global/icons/mapping/waypoint-freedom-red.svg',
  shadowUrl: null,

  iconSize: [35, 46], // size of the icon
  iconAnchor: [17, 46], // point of the icon which will correspond to marker's location
  popupAnchor: [-3, -76], // point from which the popup should open relative to the iconAnchor
});

export interface LayerConfig {
  url: string;
  title: string;
  color: string;
  hoverColor?: string;
  iconSrc?: string;
}

interface LayerRecord {
  layer: FeatureLayer;
  config: LayerConfig;
}

@Component({
  tag: 'cob-map',
  styleUrls: ['map.css', '../../node_modules/leaflet/dist/leaflet.css'],
})
export class CobMap {
  @Element() el;

  @Prop({ context: 'isServer' })
  private isServer: boolean;

  @Prop() title: string;
  @Prop() latitude: number = 42.357004;
  @Prop() longitude: number = -71.062309;
  @Prop() zoom: number = 14;
  @Prop() showZoomControl: boolean = false;
  @Prop() showLegend: boolean = false;
  @Prop() showAddressSearch: boolean = false;
  @Prop() addressSearchPlaceholder: string = 'Search for an address…';
  @Prop() basemapUrl: string = DEFAULT_BASEMAP_URL;

  @Prop() openOverlay: boolean = false;

  // Used to keep our IDs distinct on the page
  idSuffix = Math.random()
    .toString(36)
    .substring(2, 7);

  map: LeafletMap;
  zoomControl: LeafletControl;
  addressSearchControl: GeosearchControl;
  // We keep a reference to the DOM element for the search control because we
  // want to move it into our overlay, rather than have it as an Esri control.
  addressSearchControlEl: HTMLElement | null;
  addressSearchResultsLayers: LeafletLayerGroup;

  // Used to distinguish between map moves that come from the UI and those that
  // come from someone external changing our attributes. Keeps us from
  // redundantly (and often mistakenly) updating the map when it's already
  // updated.
  mapMoveInProgress: boolean;

  // We keep track of element -> layer info in this map so that if a config
  // child element's values update we can modify the layer.
  layerRecordsByConfigElement: Map<HTMLElement, LayerRecord> = new Map();
  // Configs are copied into this State to trigger re-rendering.
  @State() layerConfigs: LayerConfig[] = [];

  componentWillLoad() {
    if (this.isServer) {
      // We don't want to mount Leaflet on the server, even though it does
      // serialize the generated elements, since Leaflet then won't start
      // up correctly when we hit the browser.
      return;
    }

    this.map = Lmap(this.el, {
      zoomControl: false,
      // This the max we have for the "Gray" Esri map, so we don't allow
      // zooming in any further, even though the Boston map supports it.
      maxZoom: 16,
    })
      .setView([this.latitude, this.longitude], this.zoom)
      // Boston basemap only includes Boston, so we layer over Esri's "Gray"
      // basemap.
      .addLayer(basemapLayer('Gray'))
      .addLayer(tiledMapLayer({ url: this.basemapUrl }));

    this.zoomControl = Lcontrol.zoom({
      position: 'bottomright',
    });

    this.addressSearchControl = geosearch({
      expanded: true,
      placeholder: this.addressSearchPlaceholder,
      collapseAfterResult: false,
      zoomToResult: true,
      searchBounds: BOSTON_BOUNDS,
    });

    (this.addressSearchControl as any).on(
      'results',
      this.onAddressSearchResults.bind(this)
    );

    this.addressSearchResultsLayers = LlayerGroup().addTo(this.map);

    this.map.on({
      moveend: this.handleMapPositionChangeEnd.bind(this),
      zoomend: this.handleMapPositionChangeEnd.bind(this),
    });

    this.updateControls();
  }

  componentDidLoad() {
    this.map.invalidateSize();
  }

  componentDidUnload() {
    this.map.remove();
    this.layerRecordsByConfigElement = new Map();
  }

  componentDidUpdate() {
    // If we're showing the search control we need to add it again to the page
    // after a re-render.
    if (this.addressSearchControlEl) {
      this.el
        .querySelector('.cob-address-search-field-container')
        .appendChild(this.addressSearchControlEl);
    }
  }

  @Listen('cobMapEsriLayerConfig')
  onChildEsriDataConfig(ev) {
    ev.stopPropagation();
    this.addEsriLayer(ev.target, ev.detail);
  }

  onFeatureMouseOver(configElement: HTMLElement, ev: LeafletEvent) {
    const layerRecord = this.layerRecordsByConfigElement.get(configElement);
    if (!layerRecord) {
      return;
    }

    const feature: LeafletPath = ev.target;
    const { config } = layerRecord;

    if (config.hoverColor) {
      feature.setStyle(this.makeFeatureHoverStyle(config));
      feature.bringToFront();
    }
  }

  onFeatureMouseOut(configElement: HTMLElement, ev: LeafletEvent) {
    const layerRecord = this.layerRecordsByConfigElement.get(configElement);
    if (!layerRecord) {
      return;
    }

    const feature: LeafletPath = ev.target;
    const { config } = layerRecord;

    if (config.hoverColor) {
      feature.setStyle(this.makeFeatureStyle(config));
    }
  }

  onAddressSearchResults(data) {
    this.addressSearchResultsLayers.clearLayers();
    for (var i = data.results.length - 1; i >= 0; i--) {
      this.addressSearchResultsLayers.addLayer(
        Lmarker(data.results[i].latlng, {
          icon: WAYPOINT_ICON,
        })
      );
    }
  }

  makeFeatureStyle(config: LayerConfig) {
    return {
      color: config.color,
      weight: 3,
    };
  }

  makeFeatureHoverStyle(config: LayerConfig) {
    return {
      color: config.hoverColor || config.color,
      weight: 4,
    };
  }

  updateLayerConfig(record: LayerRecord, config: LayerConfig) {
    record.config = config;
    record.layer.setStyle(this.makeFeatureStyle(config));
  }

  addEsriLayer(configElement: HTMLElement, config: LayerConfig) {
    const { url } = config;

    const layerRecord = this.layerRecordsByConfigElement.get(configElement);

    if (layerRecord) {
      if (
        layerRecord.config.url === url &&
        layerRecord.config.iconSrc === config.iconSrc
      ) {
        // If URL is the same then we can just update the style.
        this.updateLayerConfig(layerRecord, config);
        this.updateLayerConfigState();

        return;
      } else {
        // If URL is different we need a new layer, so remove this and fall
        // through to the new layer case.
        layerRecord.layer.remove();
      }
    }

    const options = {
      url,
      // TODO(finh): This needs to change to be about clicking for a popup
      interactive: !!config.hoverColor,
      pointToLayer: config.iconSrc
        ? (_, latlng) =>
            Lmarker(latlng, {
              icon: Licon({
                iconUrl: config.iconSrc,
                iconSize: [30, 30],
              }),
            })
        : undefined,
      onEachFeature: (_, featureLayer: L.Layer) => {
        featureLayer.on({
          mouseover: this.onFeatureMouseOver.bind(this, configElement),
          mouseout: this.onFeatureMouseOut.bind(this, configElement),
        });
      },
    };

    const layer = featureLayer(options).addTo(this.map);

    const newLayerRecord = { layer, config };
    this.updateLayerConfig(newLayerRecord, config);

    this.layerRecordsByConfigElement.set(configElement, newLayerRecord);
    this.updateLayerConfigState();
  }

  updateLayerConfigState() {
    this.layerConfigs = Array.from(this.layerRecordsByConfigElement).map(
      ([_, { config }]) => config
    );
  }

  // Handler to keep our attributes up-to-date with map movements from the UI.
  handleMapPositionChangeEnd() {
    this.mapMoveInProgress = true;

    const { lat, lng } = this.map.getCenter();
    this.el.setAttribute('latitude', lat.toString());
    this.el.setAttribute('longitude', lng.toString());
    this.el.setAttribute('zoom', this.map.getZoom().toString());

    this.mapMoveInProgress = false;
  }

  handleLegendLabelMouseClick(ev: MouseEvent) {
    this.el.openOverlay = !this.el.openOverlay;
    ev.stopPropagation();
    ev.preventDefault();
  }

  @Watch('longitude')
  @Watch('latitude')
  @Watch('zoom')
  updatePosition() {
    if (!this.mapMoveInProgress) {
      this.map.setView([this.latitude, this.longitude], this.zoom);
    }
  }

  @Watch('showZoomControl')
  @Watch('showAddressSearch')
  updateControls() {
    if (this.showZoomControl) {
      this.zoomControl.addTo(this.map);
    } else {
      this.zoomControl.remove();
    }

    if (this.showAddressSearch) {
      this.addressSearchControlEl = this.addressSearchControl.onAdd(this.map);

      // We massage the auto-generated DOM to match our Fleet classes
      const inputEl = this.addressSearchControlEl.querySelector('input');
      inputEl.setAttribute('id', this.getSearchFieldInputId());
      inputEl.classList.add('sf-i-f');
      inputEl.classList.remove('leaflet-bar');
      inputEl.parentElement.classList.add('sf-i');

      const searchIconEl = document.createElement('div');
      searchIconEl.classList.add('sf-i-b');
      inputEl.parentElement.insertBefore(searchIconEl, inputEl.nextSibling);
    } else {
      this.addressSearchControl.remove();
      this.addressSearchControlEl = null;
    }
  }

  getSearchFieldInputId() {
    return `cob-map-address-search-field-${this.idSuffix}`;
  }

  render() {
    // During server rendering, boolean attributes start out as the empty string
    // rather than a true.
    const openOverlay = this.openOverlay !== false;

    const toggleInputId = `cob-map-overlay-collapsible-${this.idSuffix}`;

    return (
      <div class="cob-overlay">
        <div class="co">
          <input
            id={toggleInputId}
            type="checkbox"
            class="co-f d-n"
            aria-hidden="true"
            checked={openOverlay}
          />
          <label
            htmlFor={toggleInputId}
            class="co-t"
            onClick={this.handleLegendLabelMouseClick.bind(this)}
          >
            {this.title}
          </label>

          <div class="co-b b--w cob-overlay-content">
            <slot name="instructions" />

            {this.showAddressSearch && (
              <div class="sf sf--md m-v500">
                <label class="sf-l">Address search</label>
                <div class="cob-address-search-field-container m-v100" />
              </div>
            )}

            {this.showLegend && (
              <div class="g cob-legend-table">
                {this.layerConfigs.map(config => (
                  <div class="g--6 cob-legend-table-row m-b200">
                    <div class="cob-legend-table-icon">
                      {this.renderLegendIcon(config)}
                    </div>
                    <div class="t--subinfo cob-legend-table-label">
                      {config.title}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  renderLegendIcon({ color, iconSrc }: LayerConfig) {
    if (iconSrc) {
      return <img src={iconSrc} width="50" height="50" />;
    } else {
      return (
        <div style={{ width: '50px', height: '3px', backgroundColor: color }} />
      );
    }
  }
}