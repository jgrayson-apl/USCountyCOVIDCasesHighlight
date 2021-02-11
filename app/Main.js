/*
  Copyright 2020 Esri

  Licensed under the Apache License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License.
  You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  See the License for the specific language governing permissions and
  limitations under the License.​
*/

define([
  "calcite",
  "dojo/_base/declare",
  "ApplicationBase/ApplicationBase",
  "dojo/i18n!./nls/resources",
  "ApplicationBase/support/itemUtils",
  "ApplicationBase/support/domHelper",
  "dojo/_base/Color",
  "dojo/colors",
  "dojo/number",
  "dojo/date",
  "dojo/date/locale",
  "dojo/on",
  "dojo/query",
  "dojo/dom",
  "dojo/dom-class",
  "dojo/dom-construct",
  "esri/identity/IdentityManager",
  "esri/core/Evented",
  "esri/core/watchUtils",
  "esri/core/promiseUtils",
  "esri/portal/Portal",
  "esri/layers/Layer",
  "esri/geometry/Multipoint",
  "esri/Graphic",
  "esri/widgets/Home",
  "esri/widgets/Search",
  "esri/widgets/Legend",
  "esri/widgets/Expand",
  "esri/widgets/TimeSlider",
], function(calcite, declare, ApplicationBase, i18n, itemUtils, domHelper,
            Color, colors, number, date, locale, on, query, dom, domClass, domConstruct,
            IdentityManager, Evented, watchUtils, promiseUtils, Portal, Layer, Multipoint,
            Graphic, Home, Search, Legend, Expand, TimeSlider){

  return declare([Evented], {

    /**
     *
     */
    constructor: function(){
      // BASE //
      this.base = null;
      // CALCITE WEB //
      calcite.init();
    },

    /**
     *
     * @param base
     */
    init: function(base){
      if(!base){
        console.error("ApplicationBase is not defined");
        return;
      }
      this.base = base;

      domHelper.setPageLocale(this.base.locale);
      domHelper.setPageDirection(this.base.direction);

      const webMapItem = this.base.results.webMapItems[0].value;

      this.base.config.title = (this.base.config.title || itemUtils.getItemTitle(webMapItem));
      domHelper.setPageTitle(this.base.config.title);

      const viewProperties = itemUtils.getConfigViewProperties(this.base.config);
      viewProperties.container = "view-container";
      viewProperties.constraints = { snapToZoom: false };

      const portalItem = this.base.results.applicationItem.value;
      const appProxies = (portalItem && portalItem.appProxies) ? portalItem.appProxies : null;

      itemUtils.createMapFromItem({ item: webMapItem, appProxies: appProxies }).then(map => {
        viewProperties.map = map;
        itemUtils.createView(viewProperties).then(view => {
          view.when(() => {
            this.viewReady(view);
          });
        });
      });
    },

    /**
     *
     * @param view
     */
    viewReady: function(view){

      // TITLE //
      dom.byId("app-title-node").innerHTML = this.base.config.title;

      // SEARCH //
      const search = new Search({ view: view, searchTerm: this.base.config.search || "" });
      const searchExpand = new Expand({
        view: view,
        content: search,
        expandIconClass: "esri-icon-search",
        expandTooltip: "Search"
      });
      view.ui.add(searchExpand, { position: "top-left", index: 0 });

      // HOME //
      const home = new Home({ view: view });
      view.ui.add(home, { position: "top-left", index: 1 });

      // APPLICATION READY //
      this.applicationReady(view);

    },

    /**
     * APPLICATION READY
     *
     * @param view
     */
    applicationReady: function(view){

      view.highlightOptions = {
        color: 'orange', fillOpacity: 0.5,
        haloColor: '#00A884', haloOpacity: 0.6
      };

      const countsPanel = document.getElementById('counts-panel');
      view.ui.add(countsPanel, "top-right");
      countsPanel.classList.remove('hide');
      const countsLabel = document.getElementById('counts-label');

      const countiesLayer = view.map.layers.find(layer => { return (layer.title === "USA Counties"); });
      countiesLayer.load().then(() => {
        view.whenLayerView(countiesLayer).then(countiesLayerView => {

          /*let countyHighlight = null;
          const updateCountyFilterAndHighlight = searchGeom => {
            countiesLayerView.filter = { geometry: searchGeom };
            countyHighlight && countyHighlight.remove() && (countyHighlight = null);
            countiesLayerView.queryFeatures(countiesLayerView.filter.createQuery()).then(filteredFS => {
              countyHighlight = countiesLayerView.highlight(filteredFS.features);
            });
          };*/


          let countyHighlight = null;
          const updateCountyFilterAndHighlight = promiseUtils.debounce((searchGeom) => {
            return promiseUtils.create((resolve, reject) => {
              if(searchGeom.points.length){
                watchUtils.whenFalseOnce(countiesLayerView, 'updating', () => {
                  countiesLayerView.filter = { geometry: searchGeom };
                  countiesLayerView.queryFeatures(countiesLayerView.filter.createQuery()).then(filteredFS => {
                    countyHighlight && countyHighlight.remove();
                    countyHighlight = countiesLayerView.highlight(filteredFS.features);
                    resolve();
                  });
                });
              } else { resolve(); }
            });
          });


          // COVID-19 CASES //
          const casesLayer = view.map.layers.find(layer => { return (layer.title === "COVID-19 Cases"); });
          casesLayer.load().then(() => {
            casesLayer.outFields = ["*"];

            // LEGEND //
            const legend = new Legend({
              view: view,
              layerInfos: [{ layer: casesLayer }],
              style: { type: 'card', layout: 'side-by-side' }
            });
            const legendExpand = new Expand({
              view: view,
              content: legend,
              expandIconClass: "esri-icon-layer-list",
              expandTooltip: "Legend"
            });
            view.ui.add(legendExpand, { position: "bottom-left" });

            // ONE DAY //
            const oneDayMinutes = ((24 * 60) - 1);

            // TIME DETAILS //
            const timeInfo = casesLayer.timeInfo;
            const layerTimeExtent = timeInfo.fullTimeExtent;
            const startDate = new Date('3/22/2020 00:00:00 UTC');
            const endDate = date.add(layerTimeExtent.end, 'minute', -oneDayMinutes);

            // INITIAL TIME EXTENT //
            view.timeExtent = casesLayer.timeExtent = { start: startDate, end: date.add(startDate, 'minute', oneDayMinutes) };

            view.whenLayerView(casesLayer).then(casesLayerView => {
              watchUtils.whenFalseOnce(casesLayerView, 'updating', () => {

                const timeSlider = new TimeSlider({
                  container: 'time-slicer-container',
                  //view: view,
                  mode: 'instant',
                  playRate: 1500,
                  fullTimeExtent: { start: startDate, end: endDate },
                  stops: { interval: { unit: 'days', value: 1 } },
                  values: [startDate]
                });
                timeSlider.watch("timeExtent", timeExtent => {

                  // VIEW TIME EXTENT //
                  view.timeExtent = {
                    start: timeExtent.start,
                    end: date.add(timeExtent.start, 'minute', oneDayMinutes)
                  };

                  // GET LOCATIONS (COUNTY CENTROIDS) OF CURRENT CASES //
                  const locationsQuery = casesLayerView.createQuery();
                  locationsQuery.set({
                    timeExtent: view.timeExtent,
                    outFields: [],
                    returnGeometry: true
                  });
                  casesLayerView.queryFeatures(locationsQuery).then(timeFS => {

                    // NUMBER OF COUNTIES //
                    countsLabel.innerHTML = timeFS.features.length.toLocaleString();

                    // SEARCH GEOMETRY //
                    const searchGeom = new Multipoint({
                      spatialReference: view.spatialReference,
                      points: timeFS.features.map(feature => {
                        return [feature.geometry.x, feature.geometry.y];
                      })
                    });

                    // UPDATE COUNTY POLYGON FILTER & HIGHLIGHT //
                    updateCountyFilterAndHighlight(searchGeom).catch(error => {
                      if(error.name !== 'AbortError'){ console.error(error); }
                    });

                  });
                });

                // START DAY-BASED ANIMATION //
                watchUtils.whenFalseOnce(view, 'updating', () => { timeSlider.play(); });

              });
            });
          });
        });
      });
    }

  });
});
