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
        pill.textContent = type.startsWith("metro") ? `${data.number}` : data.number;

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

    renderMap(data.directions[dir].relationId);
    renderStops(data.directions[dir].stops);
}

/* SWITCH DIRECTION */
function switchDirection(lineKey) {
    directionState[lineKey] = directionState[lineKey] === 0 ? 1 : 0;
    showLine(lineKey);
}

/* ----------------------------------------
   STOP LIST RENDERING WITH ANIMATION
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

    void container.offsetWidth; // force reflow
    container.classList.add("animate-in");
}

/* ----------------------------------------
   MAP RENDERING
-------------------------------------------*/
function renderMap(relationId) {
    const mapContainer = document.getElementById("mapContainer");
    mapContainer.innerHTML = ""; // clear previous map

    if (!relationId) {
        mapContainer.innerHTML = `<div class="no-map">Няма налична карта</div>`;
        return;
    }

    // Create Leaflet map
    const map = L.map(mapContainer, { zoomControl: false, attributionControl: false });

    // Add OpenStreetMap tiles
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
    }).addTo(map);

    // Fetch route from Overpass API
    const query = `
        [out:json];
        relation(${relationId});
        (._;>;);
        out body;
    `;

    fetch("https://overpass-api.de/api/interpreter", {
        method: "POST",
        body: query,
    })
        .then(res => res.json())
        .then(data => {
            // Extract coordinates
            const nodes = {};
            data.elements.forEach(el => {
                if (el.type === "node") nodes[el.id] = [el.lat, el.lon];
            });

            const polylinePoints = [];
            data.elements.forEach(el => {
                if (el.type === "way") {
                    el.nodes.forEach(id => {
                        if (nodes[id]) polylinePoints.push(nodes[id]);
                    });
                }
            });

            if (polylinePoints.length === 0) {
                mapContainer.innerHTML = `<div class="no-map">Не може да се зареди картата</div>`;
                return;
            }

            const color = COLORS.metro1 || "#ec2029"; // default color; replace with correct logic if needed

            L.polyline(polylinePoints, { color, weight: 5 }).addTo(map);
            map.fitBounds(polylinePoints);
        })
        .catch(err => {
            console.error(err);
            mapContainer.innerHTML = `<div class="no-map">Не може да се зареди картата</div>`;
        });
}
