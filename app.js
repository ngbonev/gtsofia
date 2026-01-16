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

        if (filter && (type.startsWith(filter) === false)) continue;

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
   MAP SETUP
-------------------------------------------*/
let map = null;
let mapLayer = null;

async function loadMapForRelation(relationId, lineColor) {
    const mapDiv = document.getElementById("map");
    const msg = document.getElementById("mapMessage");

    if (!relationId) {
        mapDiv.style.display = "none";
        msg.style.display = "block";
        msg.textContent = "Няма налична карта";
        return;
    }

    msg.style.display = "none";
    mapDiv.style.display = "block";

    // Init map once
    if (!map) {
        map = L.map("map");
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
            maxZoom: 19
        }).addTo(map);
    }

    // Remove previous polyline
    if (mapLayer) {
        map.removeLayer(mapLayer);
    }

    // Fetch OSM relation geometry
    const url = `https://www.openstreetmap.org/api/0.6/relation/${relationId}/full`;

    try {
        const xml = await fetch(url).then(r => r.text());
        const parser = new DOMParser();
        const data = parser.parseFromString(xml, "text/xml");

        const nodes = {};
        data.querySelectorAll("node").forEach(n => {
            nodes[n.getAttribute("id")] = [
                parseFloat(n.getAttribute("lat")),
                parseFloat(n.getAttribute("lon"))
            ];
        });

        const ways = [];
        data.querySelectorAll("way").forEach(w => {
            const nds = [...w.querySelectorAll("nd")].map(nd => nodes[nd.getAttribute("ref")]);
            ways.push(nds);
        });

        mapLayer = L.polyline(ways.flat(), {
            color: lineColor,
            weight: 4
        }).addTo(map);

        map.fitBounds(mapLayer.getBounds());
    } catch (err) {
        mapDiv.style.display = "none";
        msg.style.display = "block";
        msg.textContent = "Грешка при зареждане на картата";
    }
}

/* ----------------------------------------
   LINE DISPLAY
-------------------------------------------*/
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

    // Load map for this direction
    loadMapForRelation(data.directions[dir].relationId, color);
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
