/* ----------------------------------------
   BUILD SIDEBAR LINE LIST
-------------------------------------------*/
let directionState = {}; // track direction per line
const mapCache = {};     // store already loaded map wrappers + map instance for caching

function refreshLineList(filter = null) {
    const list = document.getElementById("lineList");
    list.innerHTML = "";

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

        pill.onclick = () => showLine(lineKey);

        list.appendChild(pill);
    }
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

    header.innerHTML = `
        <div class="line-header-icon" style="--line-color:${color}">
            <div class="icon"><img src="${icon}" alt="${data.type} icon"></div>
            <div class="line-pill ${data.type} ${data.type.startsWith("metro") ? "metro-pill " + colorClass : ""}">
                ${data.number}
            </div>
            <img class="arrow" src="https://sofiatraffic.bg/images/next.svg" alt="next">
            <span class="destination">${data.directions[dir].name}</span>
            <button class="switch-dir">Промяна на посоката</button>
        </div>
    `;

    header.querySelector(".switch-dir")
        .addEventListener("click", () => switchDirection(lineKey));

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
                cached.map.invalidateSize();
                if (cached.bounds) cached.map.fitBounds(cached.bounds, { padding: [20, 20] });
            } catch (e) {
                // If something goes wrong re-render fresh map
                console.warn("Cached map redraw failed, re-rendering:", e);
                cached.wrapper.remove();
                delete mapCache[cacheKey];
                showLine(lineKey); // re-run to create fresh map
            }
        });
    } else {
        // Create new map wrapper
        const wrapper = document.createElement("div");
        wrapper.className = "map-wrapper";
        layoutContainer.appendChild(wrapper);

        // Render map (async) -> returns { wrapper, map, bounds } on success
        const result = await renderLeafletMap(data.directions[dir], data.type, lineKey, wrapper);

        // If renderLeafletMap returned a map object, store it for reuse
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
   LEAFLET MAP LOGIC
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

async function renderLeafletMap(direction, type, lineKey, wrapper) {
    wrapper.innerHTML = ""; // clear wrapper

    if (!direction.relationId) {
        wrapper.innerHTML = `<div class="no-map">Няма налична карта</div>`;
        return { wrapper };
    }

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

        // Primary Overpass query: try to get geometry (relation members may or may not contain geometry)
        const primaryQuery = `[out:json];relation(${direction.relationId});out geom;`;
        let data;
        try {
            data = await fetchOverpass(primaryQuery, 60000);
        } catch (err) {
            console.warn("Primary Overpass fetch failed:", err);
            // try fallback below
        }

        // Helper to extract coordinate arrays from any element with geometry
        const elementsToFeatures = (elements) => {
            if (!elements || !Array.isArray(elements)) return [];
            return elements
                .filter(el => Array.isArray(el.geometry) && el.geometry.length > 0)
                .map(el => {
                    const coords = el.geometry.map(p => [p.lon, p.lat]);
                    // Use LineString per element (ways) to keep things simple
                    return {
                        type: "Feature",
                        geometry: {
                            type: "LineString",
                            coordinates: coords
                        }
                    };
                });
        };

        let features = [];
        if (data) {
            features = elementsToFeatures(data.elements);
        }

        // If no geometry was found, retry with a recursive query to fetch member ways/nodes
        if (!features || features.length === 0) {
            console.info("No geometry from primary query, trying recursive Overpass query for members...");
            try {
                const recursiveQuery = `[out:json];relation(${direction.relationId});>;out geom;`;
                const data2 = await fetchOverpass(recursiveQuery, 60000);
                features = elementsToFeatures(data2.elements);
            } catch (err) {
                console.warn("Recursive Overpass fetch failed:", err);
            }
        }

        if (!features || features.length === 0) {
            // Nothing to draw
            console.warn("No geometry available for relation", direction.relationId);
            wrapper.innerHTML = `<div class="no-map">Няма налична карта</div>`;
            return { wrapper, map };
        }

        const geojson = {
            type: "FeatureCollection",
            features
        };

        // Add GeoJSON to map
        const layer = L.geoJSON(geojson, {
            style: { color, weight: 5, opacity: 0.9 }
        }).addTo(map);

        // Fit bounds
        const bounds = layer.getBounds();
        if (bounds && typeof bounds.isValid === "function" && bounds.isValid()) {
            try {
                map.fitBounds(bounds, { padding: [20, 20] });
            } catch (e) {
                console.warn("fitBounds failed:", e);
            }
        } else {
            // fallback to city center
            map.setView([42.6977, 23.3219], 12);
        }

        // Force redraw in case container dimensions changed
        requestAnimationFrame(() => map.invalidateSize());

        // Return wrapper + map + bounds for caching
        return { wrapper, map, bounds };

    } catch (e) {
        console.error("Leaflet map error:", e);
        wrapper.innerHTML = `<div class="no-map">Няма налична карта</div>`;
        return { wrapper };
    }
}
