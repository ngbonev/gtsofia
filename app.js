/* ----------------------------------------
   BUILD SIDEBAR LINE LIST
-------------------------------------------*/
let directionState = {}; // track direction per line
let mapLayer = null;

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

/* LINE DISPLAY */
function showLine(lineKey) {
    const data = lines[lineKey];
    if (!(lineKey in directionState)) directionState[lineKey] = 0;
    const dir = directionState[lineKey];

    const header = document.getElementById("lineHeader");
    let color = COLORS[data.type] || "#000";

    if (data.type.startsWith("metro")) {
        const metroLineNumber = lineKey.split("-")[1];
        const metroKey = "metro" + metroLineNumber;
        if (COLORS[metroKey]) color = COLORS[metroKey];
    }

    const icon = ICONS[data.type.startsWith("metro") ? "metro" : data.type];

    // Animate header reset
    header.classList.remove("animate-in");
    void header.offsetWidth; // force reflow

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
            <button class="switch-dir" data-line="${lineKey}">
                Промяна на посоката
            </button>
        </div>
    `;

    header.querySelector(".switch-dir")
        .addEventListener("click", () => switchDirection(lineKey));

    header.classList.add("animate-in");

    renderStops(data.directions[dir].stops);
    showLineMap(data.directions[dir].relationId); // show map for this direction
}

function switchDirection(lineKey) {
    directionState[lineKey] = directionState[lineKey] === 0 ? 1 : 0;
    showLine(lineKey);
}

/* STOP LIST RENDERING WITH ANIMATION */
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

    void container.offsetWidth; // force reflow
    container.classList.add("animate-in");
}

/* -----------------------------
   MAP HANDLING
------------------------------*/
function showLineMap(relationId) {
    const mapContainer = document.getElementById("mapContainer");
    const placeholder = document.getElementById("mapPlaceholder");

    if (!mapContainer || !placeholder) return;

    if (!relationId) {
        // No map available
        placeholder.style.display = "flex";
        if (window.lineMap) window.lineMap.getContainer().style.display = "none";
        return;
    }

    // Map exists
    placeholder.style.display = "none";

    if (!window.lineMap) {
        window.lineMap = L.map("mapContainer").setView([42.6977, 23.3219], 12);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; OpenStreetMap contributors'
        }).addTo(window.lineMap);
    } else {
        window.lineMap.getContainer().style.display = "block";
    }

    // Remove previous line
    if (mapLayer) mapLayer.remove();

    // Fetch route from Overpass API
    const overpassQuery = `
        [out:json];
        relation(${relationId});
        (._;>;);
        out geom;
    `;

    fetch(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(overpassQuery)}`)
        .then(res => res.json())
        .then(data => {
            const latlngs = [];

            data.elements.forEach(el => {
                if (el.type === "way" && el.geometry) {
                    latlngs.push(el.geometry.map(g => [g.lat, g.lon]));
                }
            });

            if (latlngs.length > 0) {
                mapLayer = L.layerGroup(
                    latlngs.map(path => L.polyline(path, { color: 'red', weight: 5 }))
                ).addTo(window.lineMap);

                const allPoints = latlngs.flat();
                const bounds = L.latLngBounds(allPoints);
                window.lineMap.fitBounds(bounds, { padding: [50, 50] });
            }
        })
        .catch(err => console.error("OSM fetch error:", err));
}
