/* ----------------------------------------
   BUILD SIDEBAR LINE LIST
-------------------------------------------*/
let directionState = {}; // track direction per line
const mapCache = {};     // store already loaded map wrappers + map instance for caching

// Lightweight caches for geometry fetches
const relationGeoCache = {};    // relationId -> { geojson, bounds }
const inflightGeoFetches = {};  // relationId -> Promise

/* ----------------------------------------
   TIMETABLE MODAL (created once)
-------------------------------------------*/
let _timetableModal = null;
function ensureTimetableModal() {
    if (_timetableModal) return _timetableModal;

    // overlay with an iframe and a fallback area
    const overlay = document.createElement("div");
    overlay.className = "timetable-modal";
    overlay.innerHTML = `
        <div class="timetable-modal__box" role="dialog" aria-modal="true" aria-label="Разписание">
            <button class="timetable-close" aria-label="Затвори">✕</button>
            <div class="timetable-content">
                <iframe class="timetable-iframe" sandbox="allow-same-origin allow-scripts allow-forms allow-popups"></iframe>
                <div class="timetable-fallback" style="display:none; padding:20px;">
                    <p style="margin:0 0 12px; font-size:15px; color:#333;">
                        Тази страница не може да се вгради в прозорец. Можете да я отворите в нов прозорец, като натиснете бутона по-долу.
                    </p>
                    <div>
                        <button class="switch-dir open-external" type="button">Отвори в нов прозорец</button>
                        <button class="switch-dir close-inline" type="button" style="margin-left:8px;">Затвори</button>
                    </div>
                </div>
            </div>
        </div>
    `;

    // close handlers
    overlay.querySelector(".timetable-close").addEventListener("click", closeTimetable);
    overlay.addEventListener("click", (ev) => {
        if (ev.target === overlay) closeTimetable();
    });

    // external open button handler (only opens when user clicks)
    overlay.querySelector(".open-external").addEventListener("click", () => {
        const iframe = overlay.querySelector(".timetable-iframe");
        const href = iframe.dataset.src || iframe.src;
        if (href) window.open(href, "_blank", "noopener");
    });

    // close-inline button: just close modal
    overlay.querySelector(".close-inline").addEventListener("click", closeTimetable);

    document.body.appendChild(overlay);
    _timetableModal = overlay;
    return _timetableModal;
}

function openTimetable(url, opener = null) {
    if (!url) return;
    const modal = ensureTimetableModal();
    const iframe = modal.querySelector(".timetable-iframe");
    const fallback = modal.querySelector(".timetable-fallback");

    // store the opener to restore focus later
    modal._lastOpener = opener || null;

    // Reset state
    fallback.style.display = "none";
    iframe.style.display = "block";
    iframe.dataset.src = url;
    try { iframe.src = "about:blank"; } catch (e) {}

    // show modal and lock body scroll
    modal.classList.add("open");
    document.body.style.overflow = "hidden";

    // focus close button for accessibility
    const closeBtn = modal.querySelector(".timetable-close");
    if (closeBtn) closeBtn.focus();

    let loaded = false;

    const onLoad = () => {
        loaded = true;
        if (modal._timetableTimer) {
            clearTimeout(modal._timetableTimer);
            modal._timetableTimer = null;
        }
        fallback.style.display = "none";
        iframe.style.display = "block";
    };

    // attach handler; remove then add to avoid duplicates
    iframe.removeEventListener("load", onLoad);
    iframe.addEventListener("load", onLoad);

    // Start loading the iframe after a tiny delay so the modal paints first
    setTimeout(() => { iframe.src = url; }, 50);

    // If iframe doesn't load in time, show fallback inside modal (do NOT auto-open new window)
    modal._timetableTimer = setTimeout(() => {
        if (!loaded) {
            iframe.style.display = "none";
            fallback.style.display = "flex";
        }
    }, 1500);
}

function closeTimetable() {
    if (!_timetableModal) return;
    const modal = _timetableModal;
    const iframe = modal.querySelector(".timetable-iframe");
    const fallback = modal.querySelector(".timetable-fallback");

    // Clear any pending timer
    if (modal._timetableTimer) {
        clearTimeout(modal._timetableTimer);
        modal._timetableTimer = null;
    }

    // Reset iframe
    try { iframe.src = "about:blank"; } catch (e) {}

    // Hide fallback and modal
    if (fallback) fallback.style.display = "none";
    modal.classList.remove("open");

    // Restore body scrolling
    document.body.style.overflow = "";

    // Restore focus to the opener if available
    try {
        if (modal._lastOpener && typeof modal._lastOpener.focus === "function") {
            modal._lastOpener.focus();
        } else {
            document.body.focus();
        }
    } catch (e) {
        // ignore
    }
}

/* ----------------------------------------
   LINE LIST
-------------------------------------------*/
function refreshLineList(filter = null) {
    const list = document.getElementById("lineList");
    list.innerHTML = "";

    // Use fragment to reduce reflow
    const frag = document.createDocumentFragment();

    for (const lineKey in lines) {
        const data = lines[lineKey];
        const type = data.type;

        if (filter && !type.startsWith(filter)) continue;

        // Determine correct color class
        let colorClass = '';
        if (type.startsWith("metro")) {
            colorClass = getMetroColorClass(lineKey);
        }

        const pill = document.createElement("div");
        pill.className = `line-pill ${type} ${colorClass}`;
        if (type.startsWith("metro")) pill.classList.add("metro-pill");
        pill.textContent = data.number;

        // accessibility
        pill.setAttribute("role", "button");
        pill.setAttribute("tabindex", "0");

        pill.addEventListener("click", () => showLine(lineKey));
        pill.addEventListener("keydown", (ev) => {
            if (ev.key === "Enter" || ev.key === " ") {
                ev.preventDefault();
                showLine(lineKey);
            }
        });

        frag.appendChild(pill);
    }

    list.appendChild(frag);
}

refreshLineList();

/* FILTER BUTTONS */
document.querySelectorAll(".filter-btn").forEach(btn => {
    btn.addEventListener("click", () => {
        document.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        const type = btn.dataset.type;
        refreshLineList(type);
    });
});

/* SEARCH BAR */
document.getElementById("searchLine").addEventListener("input", e => {
    const q = e.target.value.toLowerCase();
    const list = document.getElementById("lineList");
    [...list.children].forEach(pill => {
        const match = pill.textContent.toLowerCase().includes(q);
        pill.style.display = match ? "flex" : "none";
    });
});

/* ----------------------------------------
   LINE DISPLAY
-------------------------------------------*/
async function showLine(lineKey) {
    const data = lines[lineKey];
    if (!(lineKey in directionState)) directionState[lineKey] = 0;
    const dir = directionState[lineKey];
    const cacheKey = `${lineKey}-${dir}`;

    const header = document.getElementById("lineHeader");
    const color = getLineColor(data.type, lineKey);
    const icon = ICONS[data.type.startsWith("metro") ? "metro" : data.type];

    // Animate header reset
    header.classList.remove("animate-in");
    void header.offsetWidth;

    const colorClass = data.type.startsWith("metro") ? getMetroColorClass(lineKey) : '';

    const hasTimetable = !!data.directions[dir].timetable;

    // timetable button markup (if any)
    const timetableButtonHtml = hasTimetable
        ? `<button class="switch-dir timetable-btn" aria-label="Разписание">Разписание</button>`
        : '';

    // Add header-actions container; if only one action, add single-action class so CSS can make it full width
    const actionsClass = hasTimetable ? "header-actions" : "header-actions single-action";

    header.innerHTML = `
        <div class="line-header-icon" style="--line-color:${color}">
            <div class="icon"><img src="${icon}" alt="${data.type} icon"></div>
            <div class="line-pill ${data.type} ${data.type.startsWith("metro") ? "metro-pill " + colorClass : ""}">
                ${data.number}
            </div>
            <img class="arrow" src="https://sofiatraffic.bg/images/next.svg" alt="next">
            <span class="destination">${data.directions[dir].name}</span>

            <div class="${actionsClass}">
                <button class="switch-dir" aria-label="Промени посоката">Промяна на посоката</button>
                ${timetableButtonHtml}
            </div>
        </div>
    `;

    // attach handlers to the specific buttons inside header-actions
    const switchBtn = header.querySelector(".header-actions .switch-dir:not(.timetable-btn)");
    if (switchBtn) {
        switchBtn.addEventListener("click", () => switchDirection(lineKey));
    }

    const ttBtn = header.querySelector(".header-actions .timetable-btn");
    if (ttBtn) {
        ttBtn.addEventListener("click", (ev) => {
            const url = data.directions[dir].timetable;
            if (!url) return;
            openTimetable(url, ev.currentTarget);
        });
    }

    header.classList.add("animate-in");

    renderStops(data.directions[dir].stops);

    // Determine map container (desktop: right of stops, mobile: below stops)
    const layoutContainer = getMapLayoutContainer();

    // Remove old map from DOM (cached wrapper remains in mapCache)
    const oldMap = document.querySelector(".map-wrapper");
    if (oldMap) oldMap.remove();

    if (mapCache[cacheKey]) {
        // Load map from cache (re-attach wrapper and ensure proper redraw)
        const cached = mapCache[cacheKey];
        layoutContainer.appendChild(cached.wrapper);

        // Ensure Leaflet recalculates size and fits bounds after reattachment
        requestAnimationFrame(() => {
            try {
                if (cached.map && typeof cached.map.invalidateSize === "function") {
                    cached.map.invalidateSize();
                    if (cached.bounds) cached.map.fitBounds(cached.bounds, { padding: [20, 20] });
                }
            } catch (e) {
                // If something goes wrong re-render fresh map
                console.warn("Cached map redraw failed, re-rendering:", e);
                cached.wrapper.remove();
                delete mapCache[cacheKey];
                showLine(lineKey); // re-run to create fresh map
            }
        });
    } else {
        // Create new map wrapper (but we will only initialize Leaflet after confirming geo exists)
        const wrapper = document.createElement("div");
        wrapper.className = "map-wrapper";
        layoutContainer.appendChild(wrapper);

        const result = await renderLeafletMap(data.directions[dir], data.type, lineKey, wrapper);

        if (result && result.wrapper && result.map) {
            mapCache[cacheKey] = result;
        }
    }
}

function switchDirection(lineKey) {
    directionState[lineKey] = directionState[lineKey] === 0 ? 1 : 0;
    showLine(lineKey);
}

/* ----------------------------------------
   STOPS LIST
-------------------------------------------*/
function renderStops(stops) {
    const container = document.getElementById("stopsContainer");
    container.classList.remove("animate-in");
    container.innerHTML = "";

    stops.forEach((stop, index) => {
        const item = document.createElement("div");
        item.className = "stop-item";
        item.style.animationDelay = `${index * 0.04}s`;
        item.textContent = (stop.onDemand ? "👋 " : "") + stop.name;
        container.appendChild(item);
    });

    void container.offsetWidth;
    container.classList.add("animate-in");
}

/* ----------------------------------------
   LEAFLET MAP LOGIC (LIGHTER + ROBUST)
-------------------------------------------*/
function getLineColor(type, lineKey) {
    if (type.startsWith("metro")) {
        const n = lineKey.split("-")[1];
        return COLORS["metro" + n] || COLORS.metro1;
    }
    return COLORS[type] || "#000";
}

function getMetroColorClass(lineKey) {
    const metroLineNumber = lineKey.split('-')[1];
    const colorClass = 'metro' + metroLineNumber;
    return COLORS[colorClass] ? colorClass : 'metro1';
}

// Determine proper container for map (desktop vs mobile)
function getMapLayoutContainer() {
    const layout = document.querySelector(".stops-map-layout");
    if (layout) return layout;          // desktop layout
    return document.querySelector(".content"); // fallback for mobile
}

async function fetchOverpass(query, timeoutMs = 60000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch("https://overpass-api.de/api/interpreter", {
            method: "POST",
            body: query,
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!res.ok) {
            const txt = await res.text().catch(() => "");
            throw new Error(`Overpass API returned ${res.status} ${res.statusText} - ${txt}`);
        }

        const json = await res.json();
        return json;
    } catch (err) {
        clearTimeout(timeoutId);
        throw err;
    }
}

// Attempt to fetch geometry for a relationId with retries and caching.
// Returns null if no usable geometry found.
async function getRelationGeometry(relationId) {
    if (!relationId) return null;

    // Return cached geometry if present
    if (relationGeoCache[relationId]) {
        return relationGeoCache[relationId];
    }

    // Dedupe concurrent fetches
    if (inflightGeoFetches[relationId]) {
        return inflightGeoFetches[relationId];
    }

    const maxAttempts = 3; // primary + up to 2 retries/backoffs
    let attempt = 0;

    const promise = (async () => {
        let lastError = null;

        // Helper: extract features from any element that has geometry (ways/nodes)
        const elementsToFeatures = (elements) => {
            if (!elements || !Array.isArray(elements)) return [];
            const features = [];

            for (const el of elements) {
                if (!el.geometry || !Array.isArray(el.geometry) || el.geometry.length === 0) continue;

                // geometry could be a list of points (node/way); we will create LineString for ways,
                // and for single-point geometries we create Point features (so schedules can still show something)
                const coords = el.geometry.map(p => [p.lon, p.lat]);

                if (coords.length >= 2) {
                    features.push({
                        type: "Feature",
                        geometry: { type: "LineString", coordinates: coords },
                        properties: el.tags || {}
                    });
                } else if (coords.length === 1) {
                    features.push({
                        type: "Feature",
                        geometry: { type: "Point", coordinates: coords[0] },
                        properties: el.tags || {}
                    });
                }
            }
            return features;
        };

        while (attempt < maxAttempts) {
            attempt++;
            try {
                // Primary: relation(...) out geom (may or may not include member geometry)
                const primaryQuery = `[out:json];relation(${relationId});out geom;`;
                let data = null;
                try {
                    data = await fetchOverpass(primaryQuery, 60000);
                } catch (errPrimary) {
                    lastError = errPrimary;
                    // If it's a transient error (e.g. 429 or network), try again below with backoff.
                }

                let features = [];
                if (data) features = elementsToFeatures(data.elements);

                // If no features from primary, try recursive query to fetch members (ways) geometry
                if (!features || features.length === 0) {
                    try {
                        const recursiveQuery = `[out:json];relation(${relationId});>;out geom;`;
                        const data2 = await fetchOverpass(recursiveQuery, 60000);
                        features = elementsToFeatures(data2.elements);
                    } catch (errRec) {
                        lastError = errRec;
                    }
                }

                if (features && features.length > 0) {
                    const geojson = { type: "FeatureCollection", features };
                    // compute numeric bounds without depending on Leaflet
                    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                    features.forEach(f => {
                        const geom = f.geometry;
                        if (!geom) return;
                        if (geom.type === "Point") {
                            const [x, y] = geom.coordinates;
                            minX = Math.min(minX, x); minY = Math.min(minY, y);
                            maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
                        } else if (geom.type === "LineString" && Array.isArray(geom.coordinates)) {
                            geom.coordinates.forEach(coord => {
                                const [x, y] = coord;
                                minX = Math.min(minX, x); minY = Math.min(minY, y);
                                maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
                            });
                        }
                    });

                    let bounds = null;
                    if (isFinite(minX) && isFinite(minY) && isFinite(maxX) && isFinite(maxY)) {
                        try {
                            // Try to create Leaflet bounds if L present
                            if (typeof L !== "undefined" && L && L.latLngBounds) {
                                bounds = L.latLngBounds([[minY, minX], [maxY, maxX]]);
                            } else {
                                // fallback to a simple object used by map code
                                bounds = { _southWest: { lat: minY, lng: minX }, _northEast: { lat: maxY, lng: maxX } };
                            }
                        } catch (e) {
                            bounds = null;
                        }
                    }

                    const cached = { geojson, bounds };
                    relationGeoCache[relationId] = cached;
                    return cached;
                } else {
                    // No geometry found for this attempt; maybe it's permanent (incomplete relation)
                    lastError = lastError || new Error("No geometry returned from Overpass for relation " + relationId);
                }
            } catch (err) {
                lastError = err;
            }

            // If we will retry, backoff a bit (exponential)
            if (attempt < maxAttempts) {
                const backoffMs = 300 * Math.pow(2, attempt - 1); // 300ms, 600ms, ...
                await new Promise(r => setTimeout(r, backoffMs));
            }
        }

        // All attempts failed / no geometry
        console.warn("getRelationGeometry: failed for relation", relationId, lastError);
        return null;
    })();

    inflightGeoFetches[relationId] = promise;

    try {
        const result = await promise;
        return result;
    } finally {
        // cleanup inflight entry
        delete inflightGeoFetches[relationId];
    }
}

async function renderLeafletMap(direction, type, lineKey, wrapper) {
    wrapper.innerHTML = ""; // clear wrapper

    if (!direction.relationId) {
        wrapper.innerHTML = `<div class="no-map">Няма налична карта</div>`;
        return { wrapper };
    }

    // First, ensure we have geometry (cached or fetched). Don't init Leaflet until we know there's something to draw.
    const relationId = direction.relationId;
    let geoData = null;
    try {
        geoData = await getRelationGeometry(relationId);
    } catch (e) {
        console.warn("Error fetching relation geometry:", e);
    }

    if (!geoData || !geoData.geojson || !geoData.geojson.features || geoData.geojson.features.length === 0) {
        wrapper.innerHTML = `<div class="no-map">Няма налична карта</div>`;
        return { wrapper };
    }

    // Create map container and initialize Leaflet now that we have geometry
    const mapDiv = document.createElement("div");
    mapDiv.className = "leaflet-map";
    wrapper.appendChild(mapDiv);

    const color = getLineColor(type, lineKey);

    try {
        const map = L.map(mapDiv, {
            zoomControl: false,
            attributionControl: false
        });

        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
            maxZoom: 19
        }).addTo(map);

        // Add GeoJSON to map (use cached geojson)
        const layer = L.geoJSON(geoData.geojson, {
            style: { color, weight: 5, opacity: 0.9 },
            pointToLayer: function(feature, latlng) {
                // small circle marker for Point features
                return L.circleMarker(latlng, { radius: 6, fillColor: color, color: "#fff", weight: 1, fillOpacity: 0.9 });
            }
        }).addTo(map);

        // Fit bounds (prefer precomputed bounds)
        const bounds = geoData.bounds || layer.getBounds();
        if (bounds && typeof bounds.isValid === "function" && bounds.isValid()) {
            try {
                map.fitBounds(bounds, { padding: [20, 20] });
            } catch (e) {
                console.warn("fitBounds failed:", e);
                map.setView([42.6977, 23.3219], 12);
            }
        } else if (bounds && bounds._southWest) {
            // bounds shaped earlier without Leaflet; convert to LatLngBounds
            try {
                const latLngBounds = L.latLngBounds(
                    [bounds._southWest.lat, bounds._southWest.lng],
                    [bounds._northEast.lat, bounds._northEast.lng]
                );
                map.fitBounds(latLngBounds, { padding: [20, 20] });
            } catch (e) {
                map.setView([42.6977, 23.3219], 12);
            }
        } else {
            map.setView([42.6977, 23.3219], 12);
        }

        // Force redraw in case container dimensions changed
        requestAnimationFrame(() => map.invalidateSize());

        return { wrapper, map, bounds };
    } catch (e) {
        console.error("Leaflet map error:", e);
        wrapper.innerHTML = `<div class="no-map">Няма налична карта</div>`;
        return { wrapper };
    }
}
