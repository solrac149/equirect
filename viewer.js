import * as THREE from "https://unpkg.com/three@0.164.1/build/three.module.js";

const imageDirectory = "./Images/";
const imageExtensions = new Set([".avif", ".gif", ".jpeg", ".jpg", ".png", ".webp"]);

const picker = document.querySelector("#picker");
const imageGrid = document.querySelector("#image-grid");
const viewer = document.querySelector("#viewer");
const canvas = document.querySelector("#scene");
const loading = document.querySelector("#loading");
const loadingText = loading.querySelector("span:last-child");
const closeViewerButton = document.querySelector("#close-viewer");
const resetButton = document.querySelector("#reset");
const autorotateButton = document.querySelector("#autorotate");
const fullscreenButton = document.querySelector("#fullscreen");
const zoomInButton = document.querySelector("#zoom-in");
const zoomOutButton = document.querySelector("#zoom-out");
const fovInput = document.querySelector("#fov");

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  preserveDrawingBuffer: true,
  powerPreference: "high-performance",
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 1100);
camera.position.set(0, 0, 0.1);

const geometry = new THREE.SphereGeometry(500, 96, 64);
geometry.scale(-1, 1, 1);

const material = new THREE.MeshBasicMaterial({ color: 0x111111 });
scene.add(new THREE.Mesh(geometry, material));

const loader = new THREE.TextureLoader();
let activeTexture = null;
let loadVersion = 0;

const state = {
  lon: 0,
  lat: 0,
  targetLon: 0,
  targetLat: 0,
  isPointerDown: false,
  pointerX: 0,
  pointerY: 0,
  pointerLon: 0,
  pointerLat: 0,
  autorotate: true,
  lastTime: performance.now(),
};

function getImageTitle(path) {
  const filename = decodeURIComponent(path.split("/").pop() || "");
  return filename.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ");
}

function isImagePath(path) {
  const cleanPath = path.split("?")[0].split("#")[0].toLowerCase();
  return [...imageExtensions].some((extension) => cleanPath.endsWith(extension));
}

async function getImages() {
  const response = await fetch(imageDirectory);

  if (!response.ok) {
    throw new Error(`Could not read ${imageDirectory}`);
  }

  const html = await response.text();
  const doc = new DOMParser().parseFromString(html, "text/html");
  const seen = new Set();

  return [...doc.querySelectorAll("a[href]")]
    .map((link) => new URL(link.getAttribute("href"), response.url))
    .filter((url) => isImagePath(url.pathname))
    .map((url) => {
      const src = `${imageDirectory}${encodeURIComponent(decodeURIComponent(url.pathname.split("/").pop()))}`;
      return { title: getImageTitle(src), src };
    })
    .filter((image) => {
      if (seen.has(image.src)) {
        return false;
      }

      seen.add(image.src);
      return true;
    })
    .sort((a, b) => a.title.localeCompare(b.title));
}

function renderPickerError(message) {
  const status = document.createElement("p");
  status.className = "picker-status";
  status.textContent = message;
  imageGrid.replaceChildren(status);
}

function createPicker(images) {
  const fragment = document.createDocumentFragment();

  if (!images.length) {
    renderPickerError("No images found in the Images folder.");
    return;
  }

  picker.style.setProperty("--picker-background", `url("${images[0].src}")`);

  images.forEach((image) => {
    const button = document.createElement("button");
    button.className = "image-card";
    button.type = "button";
    button.setAttribute("aria-label", `Open ${image.title}`);

    const thumbnail = document.createElement("img");
    thumbnail.src = image.src;
    thumbnail.alt = "";
    thumbnail.loading = "eager";

    const title = document.createElement("span");
    title.textContent = image.title;

    button.append(thumbnail, title);
    button.addEventListener("click", () => openViewer(image));
    fragment.append(button);
  });

  imageGrid.replaceChildren(fragment);
}

function clampLatitude(value) {
  return Math.max(-85, Math.min(85, value));
}

function setFov(value) {
  const fov = Math.max(35, Math.min(95, Number(value)));
  camera.fov = fov;
  camera.updateProjectionMatrix();
  fovInput.value = String(fov);
}

function setAutorotate(enabled) {
  state.autorotate = enabled;
  autorotateButton.classList.toggle("is-active", enabled);
  autorotateButton.setAttribute("aria-pressed", String(enabled));
}

function resetView() {
  state.lon = 0;
  state.lat = 0;
  state.targetLon = 0;
  state.targetLat = 0;
  setFov(70);
  setAutorotate(true);
}

function resize() {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;

  if (!width || !height) {
    return;
  }

  if (canvas.width !== width || canvas.height !== height) {
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
}

function updateCamera() {
  state.lat = THREE.MathUtils.lerp(state.lat, state.targetLat, 0.18);
  state.lon = THREE.MathUtils.lerp(state.lon, state.targetLon, 0.18);

  const phi = THREE.MathUtils.degToRad(90 - state.lat);
  const theta = THREE.MathUtils.degToRad(state.lon);
  const target = new THREE.Vector3(
    500 * Math.sin(phi) * Math.cos(theta),
    500 * Math.cos(phi),
    500 * Math.sin(phi) * Math.sin(theta),
  );

  camera.lookAt(target);
}

function render(time) {
  const delta = Math.min(64, time - state.lastTime);
  state.lastTime = time;

  if (!viewer.classList.contains("is-hidden")) {
    if (state.autorotate && !state.isPointerDown) {
      state.targetLon += delta * 0.0035;
    }

    resize();
    updateCamera();
    renderer.render(scene, camera);
  }

  requestAnimationFrame(render);
}

async function loadPanorama(image) {
  const version = ++loadVersion;
  loadingText.textContent = "Loading image";
  loading.classList.remove("is-hidden");
  material.map = null;
  material.color.set(0x111111);
  material.needsUpdate = true;

  const texture = await loader.loadAsync(image.src);

  if (version !== loadVersion) {
    texture.dispose();
    return;
  }

  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;

  if (activeTexture) {
    activeTexture.dispose();
  }

  activeTexture = texture;
  material.map = texture;
  material.color.set(0xffffff);
  material.needsUpdate = true;
  loading.classList.add("is-hidden");
}

function openViewer(image) {
  picker.classList.add("is-hidden");
  viewer.classList.remove("is-hidden");
  document.body.style.overflow = "hidden";
  resetView();
  resize();
  loadPanorama(image).catch(() => {
    loadingText.textContent = "Image failed to load";
  });
}

async function closeViewer() {
  if (document.fullscreenElement) {
    await document.exitFullscreen();
  }

  loadVersion += 1;
  state.isPointerDown = false;
  canvas.classList.remove("is-dragging");
  loading.classList.add("is-hidden");
  viewer.classList.add("is-hidden");
  picker.classList.remove("is-hidden");
  document.body.style.overflow = "";
}

canvas.addEventListener("pointerdown", (event) => {
  state.isPointerDown = true;
  state.pointerX = event.clientX;
  state.pointerY = event.clientY;
  state.pointerLon = state.targetLon;
  state.pointerLat = state.targetLat;
  canvas.setPointerCapture(event.pointerId);
  canvas.classList.add("is-dragging");
  setAutorotate(false);
});

canvas.addEventListener("pointermove", (event) => {
  if (!state.isPointerDown) {
    return;
  }

  const deltaX = event.clientX - state.pointerX;
  const deltaY = event.clientY - state.pointerY;
  state.targetLon = state.pointerLon - deltaX * 0.12;
  state.targetLat = clampLatitude(state.pointerLat + deltaY * 0.12);
});

function endPointer(event) {
  state.isPointerDown = false;
  canvas.classList.remove("is-dragging");

  if (canvas.hasPointerCapture(event.pointerId)) {
    canvas.releasePointerCapture(event.pointerId);
  }
}

canvas.addEventListener("pointerup", endPointer);
canvas.addEventListener("pointercancel", endPointer);
canvas.addEventListener("wheel", (event) => {
  event.preventDefault();
  setFov(camera.fov + Math.sign(event.deltaY) * 4);
}, { passive: false });

resetButton.addEventListener("click", resetView);
autorotateButton.addEventListener("click", () => setAutorotate(!state.autorotate));
zoomInButton.addEventListener("click", () => setFov(camera.fov - 5));
zoomOutButton.addEventListener("click", () => setFov(camera.fov + 5));
fovInput.addEventListener("input", (event) => setFov(event.target.value));
closeViewerButton.addEventListener("click", closeViewer);
fullscreenButton.addEventListener("click", async () => {
  if (document.fullscreenElement) {
    await document.exitFullscreen();
    return;
  }

  await viewer.requestFullscreen();
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !viewer.classList.contains("is-hidden")) {
    closeViewer();
  }
});
window.addEventListener("resize", resize);

getImages()
  .then(createPicker)
  .catch(() => {
    renderPickerError("The Images folder could not be read by this server.");
  });
requestAnimationFrame(render);
