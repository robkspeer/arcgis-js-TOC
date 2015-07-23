define(["dojo/_base/declare",  "dijit/_WidgetBase", "dijit/_TemplatedMixin", "dijit/_WidgetsInTemplateMixin", "dojo/Evented",
"dojo/_base/lang", "dojo/dom-construct", "dojo/_base/array", "dijit/TitlePane", "dojox/mobile/ToggleButton", "esri/InfoTemplate",
"esri/dijit/Basemap", "esri/dijit/BasemapLayer", "dojox/mobile/Pane", "dojo/dom-geometry",
"dojox/mobile/TabBar", "dojo/Deferred", "dojox/gfx", "esri/symbols/jsonUtils", "esri/request", "dojo/DeferredList", "dojox/mobile/View", "dojox/mobile/ScrollableView", "dojox/mobile/ScrollablePane",
"dojox/mobile/TabBarButton", "dojo/query", "dojo/dom-attr", "dijit/registry", "dojo/dom", "dojo/dom-style", "dojo/has", "dijit/form/CheckBox", "dojox/mobile/Icon",
"dojo/dnd/Moveable", "dijit/form/Button", "dojo/_base/window", "dojox/mobile/Slider", "esri/layers/ArcGISTiledMapServiceLayer", "esri/dijit/BasemapGallery",
"dojo/text!./templates/TOC.html", "xstyle/css!./css/TOC.css"],
function(declare, _WidgetBase, _TemplatedMixin, _WidgetsInTemplateMixin, Evented,
lang, domConstruct, array, TitlePane, ToggleButton, InfoTemplate,
Basemap, BasemapLayer, Pane, domGeom,
TabBar, Deferred, gfx, jsonUtils, esriRequest, DeferredList, View, ScrollableView, ScrollablePane,
TabBarButton, query, domAttr, registry, dom, domStyle, has, CheckBox, Icon,
Moveable, Button, win, Slider, ArcGISTiledMapServiceLayer, BasemapGallery,
template, dijitStyleSheet) {

    return declare([_WidgetBase, _TemplatedMixin, _WidgetsInTemplateMixin, Evented], {

        templateString: template,
        baseClass: "toc",

        options: {
            map: null,         // required, esri/Map. the esri.map associated with the layers.
            layerList: null,   // required, an [array of {objects}] with these properties: {layer: (esri/layers/ArcGISDynamicMapServiceLayer or esri/layers/FeatureLayer, required),
                               //                                                           tab: (string, optional: tab name as a string.  if no tabs are provided, all layer title panes will be created on one view)
                               //                                                           subLayerOption: (string, optional: can be "first" (only the symbology of the first sublayer will be in the legend), "last" (only the last sublayer's symbology is shown), or "all" (all sublayer symbology is shown)
                               //                                                           initiallyVisible: (boolean, optional.  set to false to override default visibility of the layer)
                               //                                                           title: (string, optional.  if the layer is an esri/layers/FeatureLayer, you can override the layer.name property with your own name.  For example, you must do this if you add the same service twice with different queries to avoid two of the same name in the TOC.)
            basemaps: null,    // optional, array of two esri/dijit/Basemaps objects for the basemap gallery to be created.  if not specified, the basemap gallery will not be created.
            imageryPercent: 0, // optional, number (0-100). the percent of opacity of the imagery layer to start.
            height: null       // optional, number.  the height as a number (in px) for the TOC scrollable views. if no height is specified, the scrollheights will be set to "inherit"
        },

        constructor: function(options, domNode){
            var defaults = lang.mixin({}, this.options, options);
            this.map = defaults.map,
            this.layers = defaults.layerList;
            this.basemaps = defaults.basemaps;
            this.imageryPercent = defaults.imageryPercent;
            this.height = defaults.height;
            this.loaded = false;

            this._css = {
                tocToggleButton: "tocToggleButton"
            };

            if(this.basemaps){
                this.imageryInfoTemplate = new InfoTemplate("Imagery",
                    "<table>"+
                        "<tr><td>Date:</td><td>${SRC_DATE2:DateString(hideTime: true)}</td></tr>"+
                        "<tr><td>Resolution:</td><td>${SRC_RES} m</td></tr>"+
                        "<tr><td>Accuracy:</td><td>${SRC_ACC} m</td></tr>"+
                        "<tr><td>Source Name:</td><td>${NICE_NAME}</td></tr>"+
                        "<tr><td>Source Description:</td><td>${NICE_DESC}</td></tr>"+
                    "</table>"
                );
                this.imageryLayer = new ArcGISTiledMapServiceLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer", {
                    id: "imagery",
                    opacity: 0
                });
                this.imageryLayer.suspend();
                this.map.addLayer(this.imageryLayer, 1);
                var rootObj = this;
                this.map.on("load", function(){
                    rootObj._setInfoTemplates();
                });
                this.map.on("zoom-end", function(){
                    rootObj._setInfoTemplates();
                });
            }
        },

        postCreate: function(){
            if(domStyle.get(this.tocLayerInfoWindow, "background-color") === "rgba(0, 0, 0, 0)"){
                var background = domStyle.get(win.body(), "background-color");
                domStyle.set(this.tocLayerInfoWindow, "background-color", background);
            };
            domConstruct.place(this.tocLayerInfoWindow, win.body());
            if(this.basemaps){
                var currentBasemap = this.map.getBasemap();
                this.basemapGallery = new BasemapGallery({
                    showArcGISBasemaps: false,
                    basemaps: this.basemaps,
                    map: this.map
                }, this.BasemapGalleryNode);
                this.basemapGallery.startup();
                this.basemapGallery.select(currentBasemap);
                this.basemapFadeSlider.set("value", this.imageryPercent);
                this._setImageryVisibility();
            }
            else{
                domConstruct.destroy(this.basemapGallery);
            }
        },

        startup: function(){
            var tabs = [];
            array.forEach(this.layers, function(layer){
                if(layer.tab && tabs.indexOf(layer.tab) === -1){
                    tabs.push(layer.tab);
                }
            }, this);
            var scrollHeight;
            if(!this.height){
                scrollHeight = "";
            }
            else{
                scrollHeight = this.height;
            }
            if (tabs.length > 0){
                var TOC_TabBarDiv = domConstruct.create("ul", {}, this.tocContainer, "last");
                var TOC_TabBar = new TabBar({
                    barType: "segmentedControl",
                    fill: "always"
                }, TOC_TabBarDiv);

                var divTOCLayerListCont = domConstruct.create("div", {}, this.tocContainer, "last");
                // the fill: "always" parameter for the TabBar doesn't seem to work, so fix tab width here:
                var tabWidth = (((1 / tabs.length) * 100) - 1) + "%";
                // create a scrollable view for each of the tabs that was inputed.
                array.forEach(tabs, function(tab){
                    // create a button for each tab.
                    var tabBarButtonDiv = domConstruct.create("li", {style: "width: " + tabWidth + " !important;"}, TOC_TabBar.domNode);
                    var tabBarButton = new TabBarButton({moveTo: (tab + "LayerList"), innerHTML: tab, id: (tab + "TabBarButton")}, tabBarButtonDiv);
                    tabBarButton.startup();
                    // create a view for each tab.
                    var viewDiv = domConstruct.create("div", {style: "height: 100%"}, divTOCLayerListCont); // blank, empty div that will become the View
                    var tabView = new ScrollableView({id: (tab + "LayerList"), class:"tocScrollableView", fadeScrollBar: false, height: scrollHeight}, viewDiv); // the view // , height: LayerListContHeight - 10 + "px"
                    var layerDiv = domConstruct.create("div", {id: tab}, tabView.domNode);
                    tabView.startup();
                }, this);
                // select the first tab bar button:
                registry.byNode(TOC_TabBar.domNode.childNodes[0]).set('selected', true);
            }
            else{
                var divTOCLayerListCont = domConstruct.create("div", {}, this.tocContainer, "last");
                var viewDiv = domConstruct.create("div", {style: "height: 100%;"}, divTOCLayerListCont); // blank, empty div that will become the View
                var tabView = new ScrollableView({class:"tocScrollableView", id:"LayerList", fadeScrollBar: false, height: scrollHeight}, viewDiv); // the view // , height: LayerListContHeight - 10 + "px"
                var layerDiv = domConstruct.create("div", {id: "tab"}, tabView.domNode);
                tabView.startup();
            }

            this.tocMoveableWindow = new Moveable(this.tocLayerInfoWindow, {handle: this.tocLayerInfoHeader});
            this.tocCloseLayerInfo.startup();
            this.tocLegendThumbnailsScrollable.startup();
            this.tocLayerInfoScrollPane.startup();
            this.map.on("zoom-end", lang.hitch(this, function(evt){
                this._updateCheckboxes();
            }));

            var buildRequests = [];
            array.forEach(this.layerList, function(layerListLayer) {
                var request = lang.hitch(this, function(){
                    var reqD = new Deferred();
                    this._buildRequest(layerListLayer).then(lang.hitch(this, function(results){
                        // console.debug(results);
                        reqD.resolve("buildRequestDone.");
                    }));
                    return reqD;
                });
                buildRequests.push(request());
            },this);
            var buildRequestDeferredList = new DeferredList(buildRequests);
            buildRequestDeferredList.then(lang.hitch(this, function(requestResults){
                this._updateCheckboxes();
                this.updateLayerVisibility();
                var ScrollableViews = query(".tocScrollableView");
                array.forEach(ScrollableViews, function(view){
                    registry.byId(view.id).resize();
                });
                this.loaded = true;
                this.emit("load", "TOC FULLY LOADED.");
            }));
        },

        _setInfoTemplates: function(){
            // down to and including 72k: index 1 (Low Resolution 15m Imagery)
            // 4k - 36k : index 0 (NAIP)
            // 1k & 2k : index 3 (High Resolution 30cm Imagery)
            var scale = this.map.getScale();
            console.debug(scale);
            if(scale > 72000){
                this.imageryLayer.setInfoTemplates({
                    1: {
                        infoTemplate: this.imageryInfoTemplate
                    }
                });
            }
            else if (scale < 72000 && scale > 4000){
                this.imageryLayer.setInfoTemplates({
                    0: {
                        infoTemplate: this.imageryInfoTemplate
                    }
                });
                console.debug("NAIP");
            }
            else if (scale < 4000){
                this.imageryLayer.setInfoTemplates({
                    3: {
                        infoTemplate: this.imageryInfoTemplate
                    }
                });
                console.debug("High Resolution 30cm Imagery");
            }
        },

        _updateCheckboxes: function(){
            var currentScale = this.map.getScale();
            array.forEach(this.layerList, function(layerListLayer){
                if(layerListLayer.layer.type === "Feature Layer"){
                    if(layerListLayer.layer.minScale || layerListLayer.layer.maxScale){
                        var checkbox = dom.byId(layerListLayer.layer.name + " TOC Checkbox");
                        if(layerListLayer.layer.minScale < currentScale || layerListLayer.layer.maxScale > currentScale){
                            if(checkbox){
                                checkbox.disabled = true;
                                domStyle.set(checkbox, "opacity", "1");
                            }
                        }
                        else{
                            if(checkbox){
                                if(checkbox.disabled === true){
                                    checkbox.disabled = false;
                                    domStyle.set(checkbox, "opacity", "0.05");
                                }
                            }
                        }
                    }
                }
                else{
                    array.forEach(layerListLayer.layer.layerInfos, function(info){
                        if(info.minScale || info.maxScale){
                            var checkbox = dom.byId(info.name + " TOC Checkbox");
                            if(info.minScale < currentScale || info.maxScale > currentScale){
                                if (checkbox){
                                    checkbox.disabled = true;
                                    domStyle.set(checkbox, "opacity", "1");
                                }
                            }
                            else{
                                if(checkbox){
                                    if(checkbox.disabled === true){
                                        checkbox.disabled = false;
                                        domStyle.set(checkbox, "opacity", "0.05");
                                    }
                                }
                            }
                        }
                    }, this);
                }
            }, this);
        },

        _buildRequest: function(layerListLayer){
            var buildRequestDeferred = new Deferred(); // a new build request so we know when the TOC is all built for the layerListLayer.
            if (layerListLayer.layer.type === "Feature Layer") { // feature layers are straight forward.  There is only one type,
                this._buildFeatureLayerSymbologyTable(layerListLayer.layer).then( // so send it right to the feature layer content.
                    lang.hitch(this, function(results) { // then hitch this to the results,
                        // console.debug("FEATURE LAYER RESULTS:", layerListLayer, results);
                        var title;
                        if(layerListLayer.title){
                            title = layerListLayer.title;
                        }
                        else{
                            title = layerListLayer.layer.name;
                        }
                        var visible;
                        if(layerListLayer.initiallyVisible === false){
                            visible = false;
                        }
                        else if(layerListLayer.initiallyVisible === true){
                            visible = true;
                        }
                        else{
                            visible = layerListLayer.layer.defaultVisibility;
                        }
                        this._BuildTOCtitlePane(visible, title, results, layerListLayer.tab).then(lang.hitch(this, function(results){
                            buildRequestDeferred.resolve("TOC Title Pane fully built for feature layer " + layerListLayer.layer.name); // it's all built
                        })); // and send the results to the Build function.

                    })
                );
            }
            else { // it is a dynamic layer or a raster layer.
                var layerInfos = [];
                // ImageParameters have been defined, so we need to only add those layers which have been defined to show.
                if (layerListLayer.layer._params.layers === "show:-1"){
                    console.debug("ALL LAYERS TURNED OFF FOR LAYER:", layerListLayer.layer.id);
                    array.forEach(layerListLayer.layer.layerInfos, function(layerInfo) {
                      layerInfos.push(layerInfo);
                    });
                }
                else if(layerListLayer.layer._params.layers && (layerListLayer.layer._params.layers.search("show:") == 0)){ // TODO: might have to deal with other ImageParameters constants (exlcude, hide, include)
                    // console.debug("IMAGE PARAMS SET FOR LAYER " + layerListLayer.layer.id + " " + layerListLayer.layer._params.layers);
                    var imageParamLayerIds = layerListLayer.layer._params.layers.slice(5); // split the string after the "show:" so we have a string of just IDs
                    layerInfosIdsStringArray = imageParamLayerIds.split(","); // make an array out of the IDs
                    layerInfosIdsNumArray = array.map(layerInfosIdsStringArray, function(id){ // map the string IDs into an array of Number IDs
                        return Number(id);
                    });
                    array.forEach(layerListLayer.layer.layerInfos, function(layerInfo){ // go thru each of the layer infos for the layer
                        if(layerInfosIdsNumArray.indexOf(layerInfo.id) != -1){ // and if the ID matches an ID in the ImageParameter IDs
                            layerInfos.push(layerInfo); // push it into the layerInfos array to make a TOC line.
                        }
                    });
                }
                // ImageParameters have not been defined, so push all the layerInfos into the array to make a TOC line.
                else{
                    array.forEach(layerListLayer.layer.layerInfos, function(layerInfo) {
                      layerInfos.push(layerInfo);
                    });
                }
                var buildLayerInfosTasks = []; // empty array to hold the deferreds that will let us know when the TOC Title Pane is built for each layerInfo for the layer.
                array.forEach(layerInfos, function(layerInfo) { // go thru each
                    var buildLayerInfoTOC = lang.hitch(this, function(){
                        var eachLayerInfoDeferred = new Deferred();
                        var visible;
                        if(layerListLayer.initiallyVisible === false || !layerInfo.defaultVisibility){
                            visible = false;
                        }
                        else{
                            visible = true;
                        }
                        if (layerInfo.parentLayerId === -1) { // it is not a sub-layer.
                            var requestUrl = layerListLayer.layer.url + "/" + layerInfo.id + "/layers";
                            this._RequestLayerInfo(requestUrl).then( // get the Layer Info from the URL, to determine the feature Type.
                                lang.hitch(this, function(_RequestLayerInfoResolved) { // hitch up the instance to the resolved response.
                                    var response = _RequestLayerInfoResolved;
                                    if (response.type === "Feature Layer"){ // this is one layer,
                                        this._TOCgetDynamicFeatureContent(response, layerListLayer.layer, layerInfo).then( // so get the symbology/labels.
                                            lang.hitch(this, function(results) { // take the result
                                                this._BuildTOCtitlePane(visible, layerInfo.name, results, layerListLayer.tab).then(lang.hitch(this, function(results){ // and send it to the build title pane.
                                                    eachLayerInfoDeferred.resolve("TOC Title Pane built for layerInfo " + layerInfo.name);
                                                }));
                                            })
                                        );
                                    }
                                    else if (response.type === "Raster Layer") {
                                        this._RequestLayerInfo(layerListLayer.layer.url+"/legend").then(lang.hitch(this, function(layerInfoResponse) {
                                            this._TOCgetDynamicFeatureContent(layerInfoResponse, layerListLayer.layer, layerInfo).then(lang.hitch(this, function(results) {
                                                this._BuildTOCtitlePane(visible, layerInfo.name, results, layerListLayer.tab).then(lang.hitch(this, function(results){
                                                    eachLayerInfoDeferred.resolve("TOC Title Pane built for layerInfo " + layerInfo.name);
                                                }));
                                            }));
                                        }));
                                    }
                                    else if (response.type === "Group Layer") {
                                        if (layerListLayer.subLayerOption === "all" || !layerListLayer.subLayerOption){ // add all the sublayer symbology to the TOC.
                                            var tasks = [];
                                            array.forEach(response.subLayers, function(layer) {
                                                var requestUrl = layerListLayer.layer.url + "/" + layer.id + "/layers";
                                                tasks.push(this._RequestLayerInfo(requestUrl));
                                            }, this);
                                            var dlTasks = new DeferredList(tasks);
                                            dlTasks.then(lang.hitch(this, function(results) {
                                                var resultsTasks = [];
                                                array.forEach(results, function(result) {
                                                    resultsTasks.push(this._TOCgetDynamicFeatureContent(result[1], layerListLayer.layer, layerInfo));
                                                }, this);
                                                var dlResultsTasks = new DeferredList(resultsTasks);
                                                dlResultsTasks.then(lang.hitch(this, function(results) {
                                                    var legendTableResult = domConstruct.create("div");
                                                    array.forEach(results, function(result) {
                                                        domConstruct.place(result[1], legendTableResult);
                                                    }, this);
                                                    this._BuildTOCtitlePane(visible, layerInfo.name, legendTableResult, layerListLayer.tab).then(lang.hitch(this, function(results){
                                                        eachLayerInfoDeferred.resolve("TOC Title Pane built for layerInfo " + layerInfo.name);
                                                    }));
                                                }));
                                            }));
                                        }
                                        else if (layerListLayer.subLayerOption === "first"){ // only add the first sublayer's symbology to the TOC.
                                            var firstRequestUrl = layerListLayer.layer.url + "/" + response.subLayers[0].id + "/layers";
                                            this._RequestLayerInfo(firstRequestUrl, layerListLayer, layerInfo).then(lang.hitch(this, function(_RequestLayerInfoResolved) {
                                                this._TOCgetDynamicFeatureContent(_RequestLayerInfoResolved, layerListLayer.layer, layerInfo).then(lang.hitch(this, function(results) {
                                                    this._BuildTOCtitlePane(visible, layerInfo.name, results, layerListLayer.tab).then(lang.hitch(this, function(results){
                                                        eachLayerInfoDeferred.resolve("TOC Title Pane built for layerInfo " + layerInfo.name);
                                                    }));
                                                }));
                                            }));
                                        }
                                        else if (layerListLayer.subLayerOption === "last"){ // only add the first sublayer's symbology to the TOC.
                                            var index = (response.subLayers.length) - 1;
                                            var lastRequestUrl = layerListLayer.layer.url + "/" + response.subLayers[index].id + "/layers";
                                            this._RequestLayerInfo(lastRequestUrl, layerListLayer, layerInfo).then(lang.hitch(this, function(_RequestLayerInfoResolved) {
                                                this._TOCgetDynamicFeatureContent(_RequestLayerInfoResolved, layerListLayer.layer, layerInfo).then(lang.hitch(this, function(results) {
                                                    this._BuildTOCtitlePane(visible, layerInfo.name, results, layerListLayer.tab).then(lang.hitch(this, function(results){
                                                        eachLayerInfoDeferred.resolve("TOC Title Pane built for layerInfo " + layerInfo.name);
                                                    }));
                                                }));
                                            }));
                                        }
                                    }
                                })
                            );
                        }
                        else{ // it's a sub-layer,
                            eachLayerInfoDeferred.resolve("-- Skipping layerInfo " + layerInfo.name + " because it is a child layer."); // so just resolve.
                        }
                        return eachLayerInfoDeferred;
                    });
                    buildLayerInfosTasks.push(buildLayerInfoTOC());
                },this);
                var buildEachInfoDL = new DeferredList(buildLayerInfosTasks);
                buildEachInfoDL.then(lang.hitch(this, function(results){
                    array.forEach(results, function(result){
                        // console.debug(result[1]);
                    });
                    buildRequestDeferred.resolve("TOC Title Pane fully built for dynamic layer " + layerListLayer.layer.id);
                }));
            }
            return buildRequestDeferred.promise; // return the promise that we will finish the function.
        },

        _setImageryVisibility: function(){
            var value = this.basemapFadeSlider.get("value");
            if(value === 0){
                this.imageryLayer.suspend();
            }
            else{
                if(this.imageryLayer.suspended){
                    this.imageryLayer.resume();
                }
                this.imageryLayer.setOpacity(value / 100);
            }
        },

        _expandAll: function(){
            // console.log(this.expandAllButton.checked);
            var TOCtitlePanes = query(".TOC_TitlePane");
            var TOCtoggleButtons = query(".tocToggleButton");
            if(this.expandAllButton.checked){
                this.expandAllButton.set("label", "Collapse All");
                array.forEach(TOCtitlePanes, function(titlePane){
                    registry.byId(titlePane.id).set("open", true);
                });
                array.forEach(TOCtoggleButtons, function(toggleButton){
                    registry.byId(toggleButton.attributes.widgetid.value).set("checked", true);
                });
            }
            else{
                this.expandAllButton.set("label", "Expand All");
                array.forEach(TOCtitlePanes, function(titlePane){
                    registry.byId(titlePane.id).set("open", false);
                });
                array.forEach(TOCtoggleButtons, function(toggleButton){
                    registry.byId(toggleButton.attributes.widgetid.nodeValue).set("checked", false);
                });
                var TOCscrollablePanes = query(".tocScrollableView");
                array.forEach(TOCscrollablePanes, function(scrollPane){
                    registry.byId(scrollPane.id).scrollTo({x:0, y:0});
                });
            }
        },

        _BuildTOCtitlePane: function (visible, layerTitle, results, tab) {
            var buildTOCtitlePanDeferred = new Deferred();
            var tp = new TitlePane({
                id : (layerTitle + " TOC TitlePane"),
                class : "tocTitlePane",
                content : results,
                open : false,
                toggleable : false
            });
            if(tab){
                domConstruct.place(tp.domNode, tab, "last");
            }
            else{
                domConstruct.place(tp.domNode, "tab", "last");
            }
            var titlePaneTitleLine = domConstruct.create("span", {id: layerTitle + " TOC Title Line Span"});
            var titlePaneCheckBox = domConstruct.create("input", {id: layerTitle + " TOC CheckBox Input", style: "display: inline-block;"}, titlePaneTitleLine);
            var boundUpdateVisibility = lang.hitch(this, this.updateLayerVisibility);
            var checkBox = new CheckBox({
                name: layerTitle,
                checked: visible,
                style: "display: inline-block;",
                id: (layerTitle+" TOC Checkbox"),
                onChange: function(){boundUpdateVisibility();}
            }, titlePaneCheckBox).startup();
            domConstruct.place(titlePaneTitleLine, tp.titleNode, "first");
            // the span and icon for info
            var titlePaneInfoButtonSpan = domConstruct.create("span", {id: layerTitle + " TOC Info Icon Span", style:"width: 20px !important; height: 20px !important"}, titlePaneTitleLine);
            var boundShowLayerInfo = lang.hitch(this, this._ShowLayerInfo);
            var titlePaneInfoButton = new Button ({id: layerTitle + " TOC Info Icon", onClick: function(){boundShowLayerInfo(layerTitle);}, class:"tocButtons", iconClass: "tocInfoIcon", style:"width: 20px !important; height: 20px !important"}, titlePaneInfoButtonSpan);
            // the actual label.
            var titlePaneLabel = domConstruct.create("label", {for: layerTitle + " TOC Checkbox", innerHTML: " " + layerTitle, id: layerTitle + " TOC Label"}, titlePaneTitleLine);
            // we are going to need the ToggleButton's scope in order to get the button's value, so
            // bind the showTOCtitlePane function here, because once we are inside the "onChange" function, the "this" is the button's scope.
            var boundShowTOCtitlePane = lang.hitch(this, this.showTOCtitlePane); // bind the _METHOD_, not the function()
            var toggle = new ToggleButton({
                checked : false,
                onChange : function(val) {boundShowTOCtitlePane(val, layerTitle + " TOC TitlePane");},
                // label : "false",
                style: "display: inline-block; top: -14px; padding-right: 0px;",
                showLabel : false,
                baseClass : this._css.tocToggleButton,
                id : (layerTitle + " TOC ToggleButton")
            }).placeAt(tp.titleNode, "first");
            toggle.startup();
            tp.startup();
            buildTOCtitlePanDeferred.resolve("Title Pane built for " + layerTitle);
            return buildTOCtitlePanDeferred.promise;
        },

        _setTitleInfo: function(layerName){
            var layerTitle, setTitleInfoDeferred = new Deferred();
            if (layerName.length > 25){
                layerTitle = layerName.substring(0, 25) + "...:";
                setTitleInfoDeferred.resolve(layerTitle);
            }
            else{
                layerTitle = layerName + ":";
                setTitleInfoDeferred.resolve(layerTitle);
            }
            return setTitleInfoDeferred.promise;
        },

        _getTextElementValue: function(targetLayer, elementType, targetService, url){
            var getTextElementValueDeferred = new Deferred();
            if (targetLayer[elementType] && targetLayer[elementType] !== ""){
                    getTextElementValueDeferred.resolve(targetLayer[elementType]);
                }
            else { // If the individual layer doesn't have a copyright, fall back to the overall Service copyright
                if (targetLayer.type === "Feature Layer"){
                    if(targetLayer.url){
                        requestUrl = targetLayer.url.substring(0, targetLayer.url.lastIndexOf('/'));
                    }
                    else{
                        requestUrl = targetService.url;
                    }
                }
                else {
                    requestUrl = targetLayer.url;
                }
                if(!requestUrl){
                    requestUrl = url;
                }
                this._RequestLayerInfo(requestUrl).then(function(response){
                    var responseElementType = elementType;
                    if (elementType === "copyright"){
                        responseElementType = "copyrightText";
                    }
                    var element = response[responseElementType];
                    if (element !== ""){
                        getTextElementValueDeferred.resolve(element);
                    }
                    else {
                        if (elementType === "copyright" || elementType === "copyrightText"){
                            var index2 = requestUrl.split("/", 2).join("/").length;
                            var index3 = requestUrl.split("/", 3).join("/").length;
                            getTextElementValueDeferred.resolve(requestUrl.substring(index2 + 1, index3));
                        }
                        else{
                            getTextElementValueDeferred.resolve("No " + elementType + " for this service is available");
                        }
                    }
                });
            }
            return getTextElementValueDeferred.promise;
        },

        _ShowLayerInfo: function(inLayer){
            var url, requestUrl, currentLegendLayerId, copywrite, targetLayer, targetLayerId, listLayer;

            domConstruct.empty(this.tocLegendThumbnails);
            domConstruct.empty(this.tocLayerSource);
            domConstruct.empty(this.tocLayerDescription);
            array.forEach(this.layerList, function(layer){
                if (layer.layer.name === inLayer){
                    targetLayer = layer.layer;
                    listLayer = layer;
                }
                if (layer.title === inLayer){
                    targetLayer = layer.layer;
                    listLayer = layer;
                }
                else{
                    array.forEach(layer.layer.layerInfos, function(layerInfo){
                      if (layerInfo.name === inLayer){
                          targetLayer = layer.layer;
                          targetLayerId = layerInfo.id;
                          listLayer = layer;
                        }
                    }, this);
                }
            }, this);
            if (targetLayer.type === "Feature Layer"){
                this._buildFeatureLayerSymbologyTable(targetLayer).then(
                    lang.hitch(this, function(featureLayerContentResolved){
                        domConstruct.place(featureLayerContentResolved, this.tocLegendThumbnails);
                        this._setTitleInfo(targetLayer.name).then(
                            lang.hitch(this, function(titleResolved){
                                this.tocLayerInfoTitle.innerHTML = titleResolved;
                                this._getTextElementValue(targetLayer, "copyright").then(
                                    lang.hitch(this, function(copyRightInfoResolved){
                                        this.tocLayerSource.innerHTML = ("<b>Source:</b> " + copyRightInfoResolved);
                                        this._getTextElementValue(targetLayer, "description").then(
                                            lang.hitch(this, function(descriptionResolved){
                                                this.tocLayerDescription.innerHTML = descriptionResolved;
                                                this._resizeInfoElements();
                                            })
                                        );
                                    })
                                );
                            })
                        );
                    })
                );
            }

            else{
                requestUrl = targetLayer.url + "/" + targetLayerId + "/layers";
                // get the layer info JSON
                this._RequestLayerInfo(requestUrl).then(lang.hitch(this, function(requestLayerInfoResolved){
                    this._setTitleInfo(requestLayerInfoResolved.name).then(lang.hitch(this, function(titleResolved){
                        this.tocLayerInfoTitle.innerHTML = titleResolved;
                        this._getTextElementValue(requestLayerInfoResolved, "copyrightText", targetLayer, requestUrl).then(lang.hitch(this, function(copyRightInfoResolved){
                            this.tocLayerSource.innerHTML = ("<b>Source:</b> " + copyRightInfoResolved);
                            this._getTextElementValue(requestLayerInfoResolved, "description", targetLayer, requestUrl).then(lang.hitch(this, function(descriptionResolved){
                                this.tocLayerDescription.innerHTML = descriptionResolved;
                                if(requestLayerInfoResolved.type === "Feature Layer"){
                                    this._TOCgetDynamicFeatureContent(requestLayerInfoResolved, targetLayer, targetLayer.layerInfos[targetLayerId]).then(
                                        lang.hitch(this, function(results){
                                            domConstruct.place(results, this.tocLegendThumbnails);
                                            this._resizeInfoElements();
                                        })
                                    );
                                }
                                else if(requestLayerInfoResolved.type === "Raster Layer"){
                                    var requestUrl = targetLayer.url + "/legend";
                                    this._RequestLayerInfo(targetLayer.url+"/legend").then(lang.hitch(this, function(layerInfoResponse) {
                                        this._TOCgetDynamicFeatureContent(layerInfoResponse, targetLayer, targetLayer.layerInfos[targetLayerId]).then(lang.hitch(this, function(results){
                                            domConstruct.place(results, this.tocLegendThumbnails);
                                            this._resizeInfoElements();
                                        }));
                                    }));
                                }



                                else if(requestLayerInfoResolved.type === "Group Layer"){
                                    if (listLayer.subLayerOption === "all" || !listLayer.subLayerOption){ // add all the sublayer symbology to the TOC.
                                        var tasks = [];
                                        array.forEach(requestLayerInfoResolved.subLayers, function(layer) {
                                            var requestUrl = listLayer.layer.url + "/" + layer.id + "/layers";
                                            tasks.push(this._RequestLayerInfo(requestUrl));
                                        }, this);
                                        var dlTasks = new DeferredList(tasks);
                                        dlTasks.then(lang.hitch(this, function(results) {
                                            var resultsTasks = [];
                                            array.forEach(results, function(result) {
                                                resultsTasks.push(this._TOCgetDynamicFeatureContent(result[1], listLayer.layer, targetLayer.layerInfos[targetLayerId]));
                                            }, this);
                                            var dlResultsTasks = new DeferredList(resultsTasks);
                                            dlResultsTasks.then(lang.hitch(this, function(results) {
                                                array.forEach(results, function(result) {
                                                    domConstruct.place(result[1], this.tocLegendThumbnails, "last");
                                                }, this);
                                                this._resizeInfoElements();
                                            }));
                                        }));
                                    }
                                    else if (listLayer.subLayerOption === "first"){ // only add the first sublayer's symbology to the TOC.
                                        var firstRequestUrl = listLayer.layer.url + "/" + requestLayerInfoResolved.subLayers[0].id + "/layers";
                                        this._RequestLayerInfo(firstRequestUrl).then(lang.hitch(this, function(_RequestLayerInfoResolved){
                                            this._TOCgetDynamicFeatureContent(_RequestLayerInfoResolved, listLayer.layer, targetLayer.layerInfos[targetLayerId]).then(lang.hitch(this, function(results) {
                                                domConstruct.place(results, this.tocLegendThumbnails, "last");
                                                this._resizeInfoElements();
                                            }));
                                        }));
                                    }
                                    else if (listLayer.subLayerOption === "last"){ // only add the first sublayer's symbology to the TOC.
                                        var index = (requestLayerInfoResolved.subLayers.length) - 1;
                                        var lastRequestUrl = listLayer.layer.url + "/" + requestLayerInfoResolved.subLayers[index].id + "/layers";
                                        this._RequestLayerInfo(lastRequestUrl).then(lang.hitch(this, function(_RequestLayerInfoResolved) {
                                            this._TOCgetDynamicFeatureContent(_RequestLayerInfoResolved, listLayer.layer, targetLayer.layerInfos[targetLayerId]).then(lang.hitch(this, function(results){
                                                domConstruct.place(results, this.tocLegendThumbnails, "last");
                                                this._resizeInfoElements();
                                            }));
                                        }));
                                    }
                                }
                            }));
                        }));
                    }));
                }));
            }
        },

        _resizeInfoElements: function(){
            this.tocLayerInfoWindow.style.display = 'block'; // render the dom, then set the heights after:
            var totalHeight = domStyle.get(this.tocLayerInfoWindow, "height"); // inside, so just get the height
            var headingHeight = domGeom.getMarginBox(this.tocLayerInfoHeader.domNode); // now we want the height, padding, margin, everything for the elements on the info window.
            var contentHolderHeight = (totalHeight - headingHeight.h); // this is what remains for the content, after the header.
            domStyle.set(this.tocLayerInfoContentHolder, "height", contentHolderHeight + "px");

            var thumbnailsBox = domGeom.getMarginBox(this.tocLegendThumbnails);
            var thumbnailsHeight;
            if (thumbnailsBox.h > (contentHolderHeight/3)){ // if the thumbnails are larger than a 3rd of the overall height,
                domStyle.set(this.tocLegendThumbnailsScrollable.domNode, "height", (contentHolderHeight/3) + "px"); // make the thumbnails take up just 1/3 of the content
                thumbnailsHeight = (contentHolderHeight/3);
            }
            else {
                domStyle.set(this.tocLegendThumbnailsScrollable.domNode, "height", thumbnailsBox.h + "px"); // otherwise set so all thumbnails can be seen.
                thumbnailsHeight = thumbnailsBox.h;
            }
            this.tocLegendThumbnailsScrollable.scrollTo({x:0, y:0});

            var layerSourceHeight = domGeom.getMarginBox(this.tocLayerSource);
            var layerDescriptionTitleHeight = domGeom.getMarginBox(this.tocLegendDescriptionTitle);
            var descriptionHeight = domGeom.getMarginBox(this.tocLayerDescription);
            var remainingHeight = contentHolderHeight - thumbnailsHeight - layerSourceHeight.h - layerDescriptionTitleHeight.h;

            if(descriptionHeight.h > remainingHeight){ // if the description overflows what is left of the content holder,
                domStyle.set(this.tocLayerInfoScrollPane.domNode, "height", remainingHeight + "px"); // set the scroll pane to the remaining height.
            }
            this.tocLayerInfoScrollPane.scrollTo({x:0, y:0});
        },

        _RequestLayerInfo: function(requestUrl) {
            var _RequestLayerInfoDeferred = new Deferred();
            var layersRequest = esriRequest({
                url : requestUrl,
                content : {f: "json"},
                handleAs : "json",
                callbackParamName : "callback"
            });
            layersRequest.then(function(response) {
                _RequestLayerInfoDeferred.resolve(response);
            });
            return _RequestLayerInfoDeferred.promise;
        },

        // builds the symbology table for the feature layer
        _buildFeatureLayerSymbologyTable: function (targetLayer) {
            var featureLayerContentDeferred = new Deferred();
            var legendTable = domConstruct.create("table", {
                id : "TOC LegendTable " + targetLayer.title
            });
            var targetLayerRenderer = [];
            if (targetLayer.renderer.infos) {
                // console.log("Feature Layer has a renderer applied.");
                targetLayerRenderer = targetLayer.renderer.infos;
            } else {
                // console.log("Feature Layer does NOT have a renderer applied.");
                targetLayerRenderer.push(targetLayer.renderer);
            }

            var uniqueRenderers = this._createUniqueRendererArray(targetLayerRenderer);

            array.forEach(uniqueRenderers, function(renderer) {
                var legendTableRow = domConstruct.create("tr", {}, legendTable);
                if(renderer.symbol.type === "picturemarkersymbol"){
                    console.debug("PICTURE MARKER SYMBOL");
                    featureLayerContentDeferred.resolve(legendTable);
                    var legendTableSwatchCell = domConstruct.create("td", {}, legendTableRow);
                    var legendTableSwatchCellContent = domConstruct.create("img", {src: renderer.symbol.url}, legendTableSwatchCell);
                    var label;
                    if (renderer.label) {
                        label = renderer.label;
                    } else if (renderer.value) {
                        label = renderer.value;
                    } else {
                        label = targetLayer.name;
                    }
                    var legendTableLabelCell = domConstruct.create("td", {
                        innerHTML : label
                    }, legendTableRow);
                }
                else{
                    var duplicate = jsonUtils.fromJson(renderer.symbol.toJson());
                    var legendTableSwatchCell = domConstruct.create("td", {
                        height : "25px",
                        width : "25px"
                    }, legendTableRow);
                    if(targetLayer.opacity){
                        domStyle.set(legendTableSwatchCell, "opacity", targetLayer.opacity);
                    }
                    var mySurface = gfx.createSurface(legendTableSwatchCell, 25, 25);
                    var descriptors = jsonUtils.getShapeDescriptors(duplicate);
                    var shape = mySurface.createShape(descriptors.defaultShape).setFill(descriptors.fill).setStroke(descriptors.stroke);
                    shape.applyTransform({
                        dx : 12.5,
                        dy : 12.5
                    });
                    var label;
                    if (renderer.label) {
                        label = renderer.label;
                    } else if (renderer.value) {
                        label = renderer.value;
                    } else {
                        label = targetLayer.name;
                    }
                    var legendTableLabelCell = domConstruct.create("td", {
                        innerHTML : label
                    }, legendTableRow);
                    featureLayerContentDeferred.resolve(legendTable);
                }
            });
            return featureLayerContentDeferred.promise;
        },

        _createUniqueRendererArray: function(targetLayerRenderer){
            // Create a unique array of the renderers, based on the label, so that you don't have a bunch of duplicates in the final TOC.
            var uniqueRenderers = []; // this will be the new, unique array.
            if(targetLayerRenderer.length > 1){ // we only have to look if there is more then one renderer.
                var rendererLabels = []; // this will be an array of unique labels.
                array.forEach(targetLayerRenderer, function(renderer){ // go thru the renderers,
                    if(rendererLabels.indexOf(renderer.label) === -1){ // and if the label is not in the array yet,
                        rendererLabels.push(renderer.label); // push it.
                    }
                });
                array.forEach(targetLayerRenderer, function(renderer){ // now go thru the renderers again,
                    if(rendererLabels.indexOf(renderer.label) != -1){ // and if the renderer's label is still in the array of labels,
                        uniqueRenderers.push(renderer); // add the array to the unique array.
                        var i = rendererLabels.indexOf(renderer.label); // then get the index of the label in the labels array,
                        rendererLabels.splice(i, 1); // and remove the label so we don't add the renderer again.
                    }
                });
            }
            else{ // if there is only one symbol, we will just use that.
                uniqueRenderers = targetLayerRenderer;
            }
            return uniqueRenderers;
        },

        _TOCgetDynamicFeatureContent: function(response, targetLayer, targetLayerInfo) {
            // console.debug("_TOCgetDynamicFeatureContent:", response, targetLayer, targetLayerInfo);
            var getDynamicFeatureContentDeferred = new Deferred();
            var legendTable = domConstruct.create("table", {
                id : "TOC LegendTable " + targetLayerInfo.name
            });
            var targetLayerRenderer = [];
            var targetLayerType;

            if (response.layers && response.layers[targetLayerInfo.id] && response.layers[targetLayerInfo.id].layerType === "Raster Layer"){
                targetLayerRenderer = response.layers[targetLayerInfo.id].legend;
                targetLayerType = "rasterSymbol";
            }

            else if (response.type === "Feature Layer") {
                if (response.drawingInfo.renderer.classBreakInfos) {
                    //console.log("CLASS BREAKS!");
                    targetLayerRenderer = response.drawingInfo.renderer.classBreakInfos;
                    targetLayerType = "classBreaks";
                } else if (response.drawingInfo.renderer.uniqueValueInfos) {
                    // console.log('UNIQUE VALUES!');
                    targetLayerRenderer = response.drawingInfo.renderer.uniqueValueInfos;
                    targetLayerType = "uniqueValues";
                } else {
                    // console.log("SINGLE SYMBOL!");
                    targetLayerRenderer.push(response.drawingInfo.renderer);
                    targetLayerType = "singleSymbol";
                }
            }

            // else if (response.layers[targetLayerInfo.id].legend) {
                // // console.log("RASTER LAYER!");
                // targetLayerRenderer = response.layers[targetLayerInfo.id].legend;
                // targetLayerType = "rasterSymbol";
            // }

            var uniqueRenderers = this._createUniqueRendererArray(targetLayerRenderer);

            array.forEach(uniqueRenderers, function(info) {
                var legendTableRow = domConstruct.create("tr", {}, legendTable);
                var legendTableSwatchCell = domConstruct.create("td", {
                    height : "25px",
                    width : "25px",
                }, legendTableRow);
                if(targetLayer.opacity){
                    domStyle.set(legendTableSwatchCell, "opacity", targetLayer.opacity);
                }
                if (targetLayerType === "classBreaks") {
                    var symbolUrl = targetLayer.url + "/" + response.id + "/images/" + info.symbol.url;
                    var legendTableSwatchCellImage = domConstruct.create("img", {
                        src : symbolUrl
                    }, legendTableSwatchCell);
                } else if (targetLayerType === "rasterSymbol") {
                    var symbolUrl = targetLayer.url + "/" + targetLayerInfo.id + "/images/" + info.url;
                    var legendTableSwatchCellImage = domConstruct.create("img", {
                        src : symbolUrl
                    }, legendTableSwatchCell);
                } else {
                    var duplicate = jsonUtils.fromJson(info.symbol);
                    var mySurface = gfx.createSurface(legendTableSwatchCell, 25, 25);
                    var descriptors = jsonUtils.getShapeDescriptors(duplicate);
                    var shape = mySurface.createShape(descriptors.defaultShape).setFill(descriptors.fill).setStroke(descriptors.stroke);
                    shape.applyTransform({
                        dx : 12.5,
                        dy : 12.5
                    });
                    // center the shape at coordinates (25, 25)
                }
                var label;
                if (info.label) {
                    label = info.label;
                } else if (info.value) {
                    label = info.value;
                } else {
                    label = response.name;
                }
                var legendTableLabelCell = domConstruct.create("td", {
                    innerHTML : label
                }, legendTableRow);
                // innerHTML: info.label
                getDynamicFeatureContentDeferred.resolve(legendTable);
            });
            return getDynamicFeatureContentDeferred.promise;
        },

        showTOCtitlePane: function(value, titlePaneId) {
            if(value === true){
                registry.byId(titlePaneId).set("open", true);
            }
            else{
                registry.byId(titlePaneId).set("open", false);
            }
        },

        toggleAllLayers: function(){
            var value = this.toggleAllCheckbox.checked;
            array.forEach(this.layerList,function(inLayer){
                if (inLayer.layer.type === "Feature Layer"){
                    var title;
                    if(inLayer.title){
                        title = inLayer.title;
                    }
                    else{
                        title = inLayer.layer.name;
                    }
                    var input = registry.byId(title + " TOC Checkbox");
                    if(input){
                        input.set("checked", value);
                    }
                }
                else{
                    array.forEach(inLayer.layer.layerInfos, function(layerInfo){
                        var input = registry.byId(layerInfo.name + " TOC Checkbox");
                        if(input){
                            input.set("checked", value);
                        }
                    }, this);
                }
            }, this);
        },

        updateLayerVisibility: function() {
            // console.log("in updateLayerVisibility");
            array.forEach(this.layerList,function(inLayer){
                var visibleDynamic = [];
                if (inLayer.layer.type === "Feature Layer"){
                    var title;
                    if(inLayer.title){
                        title = inLayer.title;
                    }
                    else{
                        title = inLayer.layer.name;
                    }
                    var input = registry.byId(title + " TOC Checkbox");
                    if (input){
                        if (input.checked){
                            inLayer.layer.resume();
                        }
                        else {
                            inLayer.layer.suspend();
                        }
                    }
                }
                else{
                    array.forEach(inLayer.layer.layerInfos, function(layerInfo){
                        // console.debug(layerInfo.name);
                        var input = registry.byId(layerInfo.name + " TOC Checkbox");
                        if (input){
                              if (input.checked){
                                  if (layerInfo.subLayerIds){
                                      visibleDynamic.push(layerInfo.id);
                                      visibleDynamic.push(layerInfo.subLayerIds);
                                  }
                                  else{
                                    visibleDynamic.push(layerInfo.id);
                                  }
                              }
                        }
                    });
                    if (visibleDynamic.length === 0){
                        inLayer.layer.suspend();
                    }
                    else{
                        if(inLayer.layer.suspended){
                            inLayer.layer.resume();
                        }
                        inLayer.layer.setVisibleLayers(visibleDynamic);
                    }
                }
         });
        },

    _closeLayerInfoWindow: function(){
        domStyle.set(this.tocLayerInfoWindow, "display", "none");
    }


    });
});