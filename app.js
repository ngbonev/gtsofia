/* ----------------------------------------
   BUILD SIDEBAR LINE LIST
-------------------------------------------*/
let directionState = {}; // track direction per line

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
            const metroLineNumber = lineKey.split('-')[1];
            colorClass = 'metro' + metroLineNumber;
            if (!COLORS[colorClass]) colorClass = 'metro1';
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

    const header = document.getElementById("lineHeader");
    let color = getLineColor(data.type, lineKey);
    const icon = ICONS[data.type.startsWith("metro") ? "metro" : data.type];

    // Animate header reset
    header.classList.remove("animate-in");
    void header.offsetWidth;

    let colorClass = '';
    if (data.type.startsWith("metro")) {
        const metroLineNumber = lineKey.split('-')[1];
        colorClass = 'metro' + metroLineNumber;
        if (!COLORS[colorClass]) colorClass = 'metro1';
    }

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

    /* ----------------------------------------
       MAP LOGIC (Desktop: right of stops)
    -------------------------------------------*/

    // Remove old map
    const oldMap = document.querySelector(".map-wrapper");
    if (oldMap) oldMap.remove();

    // Ensure the wrapper exists in DOM
    const layoutContainer = document.querySelector(".stops-map-layout");
    const wrapper = document.createElement("div");
    wrapper.className = "map-wrapper";
    layoutContainer.appendChild(wrapper);

    // Render Leaflet map inside the wrapper
    await renderLeafletMap(data.directions[dir], data.type, lineKey, wrapper);
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

async function renderLeafletMap(direction, type, lineKey, wrapper) {
    wrapper.innerHTML = ""; // clear wrapper

    if (!direction.relationId) {
        wrapper.innerHTML = `<div class="no-map">Няма налична карта</div>`;
        return wrapper;
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

        // Fetch Overpass API with 30s max wait
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s
        const res = await fetch(`https://overpass-api.de/api/interpreter`, {
            method: "POST",
            body: `[out:json];relation(${direction.relationId});out geom;`,
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        const data = await res.json();

        const geojson = {
            type: "FeatureCollection",
            features: data.elements
                .filter(el => el.type === "relation")
                .map(rel => ({
                    type: "Feature",
                    geometry: {
                        type: "MultiLineString",
                        coordinates: rel.members
                            .filter(m => m.geometry)
                            .map(m => m.geometry.map(p => [p.lon, p.lat]))
                    }
                }))
        };

        // If no features returned, show fallback
        if (!geojson.features || geojson.features.length === 0) {
            wrapper.innerHTML = `<div class="no-map">Няма налична карта</div>`;
            return wrapper;
        }

        const layer = L.geoJSON(geojson, {
            style: { color, weight: 5, opacity: 0.9 }
        }).addTo(map);

        map.fitBounds(layer.getBounds(), { padding: [20, 20] });

    } catch (e) {
        console.error("Leaflet map error:", e);
        wrapper.innerHTML = `<div class="no-map">Няма налична карта</div>`;
    }

    return wrapper;
}
