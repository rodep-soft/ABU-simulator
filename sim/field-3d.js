/* global THREE, RoboField */
(function (root) {
  'use strict';
  const T = root.THREE, F = root.RoboField;
  const palette = { red: '#c34151', blue: '#2876bd', ink: '#243e38', metal: '#d9e2df', gold: '#efbe36' };
  const point = (x, y, z = 0) => new T.Vector3(x - 5.5, z, y - 5.5);

  function create(container, onPick) {
    const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.75));
    renderer.outputColorSpace = T.SRGBColorSpace;
    renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    renderer.setClearColor('#e9efed');
    const canvas = renderer.domElement;
    canvas.id = 'field-3d'; canvas.tabIndex = 0;
    canvas.setAttribute('aria-label', '3D競技フィールド');
    container.append(canvas);
    const scene = new T.Scene(), camera = new T.PerspectiveCamera(40, 1, .05, 100);
    scene.add(new T.HemisphereLight('#ffffff', '#abbeb0', 1.7));
    const sun = new T.DirectionalLight('#fff9eb', 2.3);
    sun.position.set(-5, 14, 6); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: .1, far: 40 });
    sun.shadow.bias = -.00025; sun.shadow.normalBias = .015; scene.add(sun);
    const materialCache = new Map(), labelCache = new Map();
    const material = color => {
      if (!materialCache.has(color)) materialCache.set(color, new T.MeshStandardMaterial({ color, roughness: .76, metalness: .04 }));
      return materialCache.get(color);
    };
    const boxGeometry = new T.BoxGeometry(1, 1, 1), sphereGeometry = new T.SphereGeometry(.105, 20, 14);
    const edgesGeometry = new T.EdgesGeometry(boxGeometry);
    function box(parent, x, y, z, w, d, h, color, edge = false) {
      const mesh = new T.Mesh(boxGeometry, material(color));
      mesh.position.copy(point(x, y, z + h / 2)); mesh.scale.set(w, h, d);
      mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh);
      if (edge) mesh.add(new T.LineSegments(edgesGeometry, new T.LineBasicMaterial({ color: '#718079', transparent: true, opacity: .5 })));
      return mesh;
    }
    function label(text, color = palette.ink, width = .6) {
      const key = text + color;
      if (!labelCache.has(key)) {
        const tile = document.createElement('canvas'); tile.height = 112;
        const ctx = tile.getContext('2d');
        ctx.font = 'bold 58px "Yu Gothic UI", Meiryo, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        tile.width = Math.ceil(Math.max(100, ctx.measureText(text).width + 36));
        ctx.fillStyle = 'rgba(255,255,255,.96)'; ctx.fillRect(0, 0, tile.width, 112);
        ctx.strokeStyle = color; ctx.lineWidth = 4; ctx.strokeRect(2, 2, tile.width - 4, 108);
        ctx.font = 'bold 58px "Yu Gothic UI", Meiryo, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = color; ctx.fillText(text, tile.width / 2, 58, tile.width - 20);
        const texture = new T.CanvasTexture(tile); texture.colorSpace = T.SRGBColorSpace;
        labelCache.set(key, new T.SpriteMaterial({ map: texture, depthTest: false, transparent: true, toneMapped: false }));
      }
      const mat = labelCache.get(key), sprite = new T.Sprite(mat); sprite.scale.set(width, width * 112 / mat.map.image.width, 1); sprite.renderOrder = 10; sprite.raycast = () => {};
      return sprite;
    }
    const terrain = new T.Group(), actors = new T.Group(), objects = new T.Group(), routes = new T.Group();
    scene.add(terrain, routes, objects, actors);
    const pickables = [];
    function floor(r, z, color, h = .012) { return box(terrain, r.x + r.w / 2, r.y + r.h / 2, z - h, r.w, r.h, h, color); }
    function tag(text, x, y, z, color, width) { const s = label(text, color, width); s.position.copy(point(x, y, z)); terrain.add(s); return s; }
    function pad(r, z, color, text) {
      floor(r, z + .014, color);
      if (text) tag(text, r.x + r.w / 2, r.y + r.h / 2, z + .08, palette.ink, Math.min(r.w * .85, 1.1));
    }
    floor(F.regions.ground, -.035, '#8c9f97', .15);
    floor(F.rect(0, 0, 5.5, 11), 0, '#ead2d4');
    floor(F.rect(5.5, 0, 5.5, 11), 0, '#c7e2ed');
    box(terrain, 4, 5.5, 0, 3, 6, .6, '#e3b7b5');
    box(terrain, 7, 5.5, 0, 3, 6, .6, '#a8d1e0');
    box(terrain, 5.5, 5.5, .6, 3, 3, .3, '#d5dfd8');
    for (const r of [F.regions.sharedTop, F.regions.sharedBottom]) floor(r, .615, '#dce4d8');
    pad(F.regions.sky, 0, '#cbd4d0'); pad(F.regions.mustika, 0, '#d1dad4');
    tag('Sky', 5.5, 10.7, .06, palette.ink, .65);
    tag('Mustika', 5.5, .45, .12, '#77621a', 1);
    tag('L1', 3.1, 4.25, .67, '#795659', .5); tag('L1', 7.9, 4.25, .67, '#366d85', .5);
    tag('L2', 5.5, 4.55, .97, '#526c5c', .6);
    for (const team of ['red', 'blue']) {
      const z = F.zones[team], c = palette[team];
      pad(z.storage, 0, team === 'red' ? '#cf7c85' : '#77b6d9');
      tag('Earth', z.storage.x + 1, 1.23, .12, c, .9);
      const ramp = z.ramp, w = ramp.w, d = ramp.h;
      const shape = new T.Shape(); shape.moveTo(0, 0); shape.lineTo(d, 0); shape.lineTo(d, .6); shape.closePath();
      const geo = new T.ExtrudeGeometry(shape, { depth: w, bevelEnabled: false });
      const positions = geo.getAttribute('position');
      for (let i = 0; i < positions.count; i++) {
        const along = positions.getX(i), height = positions.getY(i), across = positions.getZ(i);
        positions.setXYZ(i, ramp.x + across - 5.5, height, ramp.y + along - 5.5);
      }
      geo.computeVertexNormals();
      const mesh = new T.Mesh(geo, material(team === 'red' ? '#cba7a5' : '#91bbcc')); mesh.castShadow = mesh.receiveShadow = true; terrain.add(mesh);
      tag('Ramp', ramp.x + .5, 4.65, .56, c, .7);
      floor(z.transfer, .6, team === 'red' ? '#eac06b' : '#65b5ce', .6);
      tag('Transfer', z.transfer.x + .5, 6.8, .67, palette.ink, .9);
      for (let i = 0; i < 3; i++) {
        const y = 7.3 + i * .3, height = F.surface({ x: z.stairs.x + .5, y: y + .15 }).z;
        box(terrain, z.stairs.x + .5, y + .15, 0, 1, .3, height, team === 'red' ? '#cba7a5' : '#91bbcc', true);
      }
      const upper = z.upperStairs;
      // The engine uses a 0.75 m landing between L1 (0.6) and L2 (0.9).
      box(terrain, upper.x + upper.w / 2, upper.y + .5, .6, upper.w, 1, .15, '#9cb8ab', true);
      pad(z.retry, .6, team === 'red' ? '#c78a8e' : '#76abc7', 'Retry');
      for (const role of ['TR', 'BR']) {
        const p = F.points[team]['start' + role];
        pad(F.rect(p.x - .35, p.y - .35, .7, .7), 0, team === 'red' ? '#ce7d86' : '#77add1');
        tag(role, p.x, 10.12, .1, c, .6);
      }
      for (const slot of F.slots(team)) pad(F.rect(slot.x - .19, slot.y - .19, .38, .38), .6, slot.type === 'earth' ? '#d9d5ba' : '#b3cde1');
    }
    for (const wall of F.walls) {
      const x = wall.x + wall.w / 2, y = wall.y + wall.h / 2;
      box(terrain, x, y, F.surface({ x, y }).z, wall.w, wall.h, .09, '#748677');
    }
    for (const s of F.spots) {
      const z = s.level === 1 ? .6 : .9;
      const padMesh = floor(F.rect(s.x - .25, s.y - .25, .5, .5), z + .016, '#5b916d');
      padMesh.userData.pick = { kind: 'spot', id: s.id }; pickables.push(padMesh);
      tag(String(F.spotNumbers[s.id]), s.x, s.y + .48, z + .1, '#244b35', .32);
    }
    function cylinder(x, y, z, height) {
      const mesh = new T.Mesh(new T.CylinderGeometry(.135, .15, height, 28), material('#8a9b90'));
      mesh.position.copy(point(x, y, z + height / 2)); mesh.castShadow = mesh.receiveShadow = true; terrain.add(mesh);
    }
    cylinder(5.5, 1.25, 0, .5); cylinder(5.5, 5.5, .9, .8);
    const outer = new T.LineLoop(new T.BufferGeometry().setFromPoints([[0, 0], [11, 0], [11, 11], [0, 11]].map(([x, y]) => point(x, y, .015))), new T.LineBasicMaterial({ color: '#61756a' })); terrain.add(outer);

    const robotMeshes = new Map(), objectMeshes = new Map();
    const selection = new T.Mesh(new T.RingGeometry(.4, .43, 48), new T.MeshBasicMaterial({ color: '#254f3b', side: T.DoubleSide, depthTest: false }));
    selection.rotation.x = -Math.PI / 2; selection.renderOrder = 9; scene.add(selection);
    const targetMarker = selection.clone(); targetMarker.material = new T.MeshBasicMaterial({ color: '#bc7a22', side: T.DoubleSide, depthTest: false }); scene.add(targetMarker);
    function robotModel(r, side) {
      const group = new T.Group(), chassis = new T.Group(); group.add(chassis);
      const localBox = (x, y, z, w, h, d, color) => {
        const m = new T.Mesh(boxGeometry, material(color)); m.position.set(x, y, z); m.scale.set(w, h, d); m.castShadow = m.receiveShadow = true; chassis.add(m); return m;
      };
      localBox(0, .14, 0, side * .87, .17, side * .9, palette[r.team]);
      localBox(0, .25, 0, side * .74, .07, side * .72, '#f1f5f3');
      const wheels = [];
      for (const x of [-side * .43, side * .43]) for (const z of [-side * .32, side * .32]) {
        const wheel = new T.Mesh(new T.CylinderGeometry(.09, .09, .07, 16), material('#36463f'));
        wheel.rotation.z = Math.PI / 2; wheel.position.set(x, .09, z); wheel.castShadow = true; chassis.add(wheel); wheels.push(wheel);
      }
      if (r.role === 'BR') {
        localBox(0, .48, -.14, .06, .5, .06, '#596f64');
        localBox(0, .73, -.14, .18, .09, .08, '#314c42');
        localBox(.055, .73, -.09, .04, .04, .025, '#e6bf4b');
      } else {
        for (const x of [-.18, .18]) localBox(x, .4, -.17, .025, .3, .025, '#697d71');
        localBox(0, .55, -.17, .39, .025, .025, '#697d71');
      }
      for (const x of [-.15, .15]) localBox(x, .31, .25, .025, .04, .16, '#879d91');
      const bodyOutline = new T.LineSegments(edgesGeometry, new T.LineBasicMaterial({ color: '#2b4337', transparent: true, opacity: .65 }));
      bodyOutline.scale.set(side, .37, side); bodyOutline.position.y = .23; group.add(bodyOutline);
      const caption = label(r.role, palette[r.team], .42); caption.position.set(0, 1.04, 0); group.add(caption);
      const cargoLabel = label('E0 / S0 / M0', palette[r.team], 1.3); cargoLabel.position.set(0, .87, 0); group.add(cargoLabel);
      const scan = new T.Mesh(new T.RingGeometry(.38, .41, 48), new T.MeshBasicMaterial({ color: '#d4a928', transparent: true, opacity: .8, side: T.DoubleSide }));
      scan.rotation.x = -Math.PI / 2; scan.position.y = .022; group.add(scan);
      group.userData.pick = { kind: 'robot', id: r.id }; pickables.push(chassis);
      actors.add(group); return { group, chassis, wheels, bodyOutline, caption, cargoLabel, scan, side, last: null, cargoText: '' };
    }
    const blockMaterials = new Map();
    function blockFaces(type, color) {
      const key = type + color;
      if (!blockMaterials.has(key)) {
        const tile = document.createElement('canvas'); tile.width = tile.height = 128;
        const c = tile.getContext('2d'); c.fillStyle = type === 'sky' ? palette[color] || '#708f84' : '#f4f7f2'; c.fillRect(0, 0, 128, 128);
        c.strokeStyle = palette[color] || '#708f84'; c.lineWidth = 14; c.strokeRect(7, 7, 114, 114);
        c.fillStyle = type === 'sky' ? '#fff' : palette[color] || '#708f84'; c.font = 'bold 82px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(type === 'earth' ? 'E' : 'S', 64, 67);
        const texture = new T.CanvasTexture(tile); texture.colorSpace = T.SRGBColorSpace;
        const top = new T.MeshStandardMaterial({ map: texture, roughness: .8 });
        const side = material(type === 'earth' ? '#f1f3eb' : '#c9d5d1');
        blockMaterials.set(key, [side, side, top, material(type === 'sky' ? palette[color === 'red' ? 'blue' : 'red'] : '#e4eadd'), side, side]);
      }
      return blockMaterials.get(key);
    }
    function objectModel(o) {
      const mesh = new T.Mesh(o.type === 'mustika' ? sphereGeometry : boxGeometry, o.type === 'mustika' ? material(palette.gold) : blockFaces(o.type, o.color || o.placedBy || o.team));
      if (o.type !== 'mustika') mesh.scale.set(o.size, o.height, o.size);
      mesh.castShadow = mesh.receiveShadow = true; mesh.userData.pick = { kind: 'object', id: o.id }; objects.add(mesh); pickables.push(mesh); return mesh;
    }
    const orbit = { azimuth: .54, polar: .68, distance: 21.5, target: new T.Vector3(0, .35, 0) };
    let active = false, current = null, options = {}, follow = false, disposed = false;
    function updateCamera() {
      const direction = new T.Vector3(Math.sin(orbit.polar) * Math.sin(orbit.azimuth), Math.cos(orbit.polar), Math.sin(orbit.polar) * Math.cos(orbit.azimuth));
      const right = new T.Vector3(Math.cos(orbit.azimuth), 0, -Math.sin(orbit.azimuth));
      const up = new T.Vector3().crossVectors(direction, right), tan = Math.tan(T.MathUtils.degToRad(camera.fov / 2));
      let fitDistance = 0;
      for (const x of [-5.65, 5.65]) for (const z of [-5.65, 5.65]) for (const y of [-.35, .65]) {
        const v = new T.Vector3(x, y, z);
        fitDistance = Math.max(fitDistance, v.dot(direction) + Math.max(Math.abs(v.dot(right)) / (tan * camera.aspect * .91), Math.abs(v.dot(up)) / (tan * .91)));
      }
      const distance = orbit.distance * fitDistance / 21.5;
      camera.position.set(orbit.target.x + distance * Math.sin(orbit.polar) * Math.sin(orbit.azimuth),
        orbit.target.y + distance * Math.cos(orbit.polar), orbit.target.z + distance * Math.sin(orbit.polar) * Math.cos(orbit.azimuth));
      camera.lookAt(orbit.target); camera.updateMatrixWorld();
    }
    function resize() {
      if (!active) return;
      const bounds = container.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      renderer.setSize(bounds.width, bounds.height, false); camera.aspect = bounds.width / bounds.height; camera.updateProjectionMatrix(); paint();
    }
    function preset(name) {
      follow = false; orbit.target.set(0, .35, 0); orbit.distance = 21.5;
      orbit.polar = name === 'top' ? .001 : .68;
      orbit.azimuth = name === 'red' ? -Math.PI / 2 : name === 'blue' ? Math.PI / 2 : .54;
      paint();
    }
    function zoom(delta) { orbit.distance = T.MathUtils.clamp(orbit.distance * Math.exp(delta), 3, 36); paint(); }
    function focus() { follow = !follow; orbit.distance = follow ? 6 : 21.5; if (!follow) orbit.target.set(0, .35, 0); paint(); return follow; }
    function paint() {
      if (!active || disposed) return;
      if (follow && current) {
        const r = current.robots.find(r => r.id === options.selected);
        if (r) orbit.target.copy(point(r.x, r.y, r.z + .25));
      }
      updateCamera(); renderer.render(scene, camera);
      container.dispatchEvent(new CustomEvent('camera-change', { detail: { follow } }));
    }
    function clearRoutes() {
      for (const m of [...routes.children]) { routes.remove(m); m.geometry.dispose(); m.material.dispose(); }
    }
    function draw(state, nextOptions) {
      current = state; options = nextOptions;
      for (const r of state.robots) {
        if (!robotMeshes.has(r.id)) robotMeshes.set(r.id, robotModel(r, options.bodySize));
        const model = robotMeshes.get(r.id);
        if (model.side !== options.bodySize) { model.chassis.scale.setScalar(options.bodySize / model.side); }
        model.group.position.copy(point(r.x, r.y, r.z));
        if (model.last && model.last.time !== state.time) {
          const dx = r.x - model.last.x, dy = r.y - model.last.y, traveled = Math.hypot(dx, dy);
          if (traveled > .002 && traveled < 1.5 && state.time > model.last.time) {
            model.chassis.rotation.y = Math.atan2(dx, dy);
            model.wheels.forEach(w => { w.rotation.x += traveled / .09; });
          }
        }
        model.last = { x: r.x, y: r.y, time: state.time };
        const cargo = r.cargo.map(id => state.objects.find(o => o.id === id));
        const cargoHeight = cargo.filter(o => o?.type !== 'mustika').reduce((h, o) => h + (o?.height || 0), .3);
        model.caption.position.y = Math.max(.95, cargoHeight + .2); model.cargoLabel.position.y = Math.max(1.4, cargoHeight + .65);
        model.cargoLabel.visible = r.id === options.selected; model.cargoLabel.scale.x = 1.05;
        const text = ['earth', 'sky', 'mustika'].map((type, i) => 'ESM'[i] + cargo.filter(o => o?.type === type).length).join(' / ');
        if (text !== model.cargoText) { model.cargoLabel.material = label(text, palette[r.team], 1.3).material; model.cargoText = text; }
        model.bodyOutline.visible = options.showBody;
        model.bodyOutline.scale.set(options.bodySize, .37, options.bodySize);
        model.scan.visible = r.job?.type === 'scan';
        model.scan.scale.setScalar(1 + .2 * Math.sin(state.time * 7));
      }
      for (const o of state.objects) {
        if (!objectMeshes.has(o.id)) objectMeshes.set(o.id, objectModel(o));
        const mesh = objectMeshes.get(o.id); mesh.visible = o.location !== 'removed';
        if (o.type !== 'mustika') mesh.material = blockFaces(o.type, o.color || o.placedBy || o.team);
        if (o.location === 'cargo') {
          const r = state.robots.find(r => r.id === o.holder), robot = robotMeshes.get(o.holder);
          if (!r) { mesh.visible = false; continue; }
          const boxes = r.cargo.filter(id => state.objects.find(o => o.id === id)?.type !== 'mustika');
          const index = boxes.indexOf(o.id), stack = boxes.slice(0, index).reduce((h, id) => h + state.objects.find(o => o.id === id).height, .3);
          const local = new T.Vector3(o.type === 'mustika' ? .22 : 0, o.type === 'mustika' ? .63 : stack + o.height / 2, o.type === 'mustika' ? -.12 : .07);
          local.applyAxisAngle(new T.Vector3(0, 1, 0), robot.chassis.rotation.y); mesh.position.copy(point(r.x, r.y, r.z).add(local));
          mesh.rotation.y = robot.chassis.rotation.y;
        } else { mesh.position.copy(point(o.x, o.y, o.z + o.height / 2)); mesh.rotation.y = 0; }
      }
      const selectedObject = options.reviewObject && state.objects.find(o => o.id === options.reviewObject);
      const r = state.robots.find(r => r.id === options.selected);
      selection.visible = !!(selectedObject || r);
      if (selectedObject || r) { const p = selectedObject || r; selection.position.copy(point(p.x, p.y, p.z + (selectedObject ? p.height : 0) + .018)); }
      targetMarker.visible = !!options.clickedPoint;
      if (options.clickedPoint) { const p = options.clickedPoint; targetMarker.position.copy(point(p.x, p.y, F.surface(p).z + .025)); }
      clearRoutes();
      if (options.showPath) for (const r of state.robots) if (r.job?.route?.length) {
        const points = [r, ...r.job.route].map(p => point(p.x, p.y, F.surface(p).z + .045));
        const line = new T.Line(new T.BufferGeometry().setFromPoints(points), new T.LineDashedMaterial({ color: palette[r.team], dashSize: .13, gapSize: .07, depthTest: false, transparent: true, opacity: .8 }));
        line.computeLineDistances(); line.renderOrder = 8; routes.add(line);
      }
      paint();
    }
    const raycaster = new T.Raycaster();
    function hitAt(clientX, clientY) {
      const b = canvas.getBoundingClientRect();
      raycaster.setFromCamera(new T.Vector2((clientX - b.left) / b.width * 2 - 1, -(clientY - b.top) / b.height * 2 + 1), camera);
      const hits = raycaster.intersectObjects([...pickables.filter(m => m.visible), terrain], true);
      const hit = hits[0]; if (!hit) return null;
      let m = hit.object; while (m && !m.userData.pick) m = m.parent;
      return { point: { x: hit.point.x + 5.5, y: hit.point.z + 5.5 }, identity: m?.userData.pick || null };
    }
    const pointers = new Map(); let clickStart = null, moved = false, gesture = null;
    const gestureState = () => {
      const p = [...pointers.values()]; if (p.length < 2) return null;
      return { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2, distance: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) };
    };
    canvas.addEventListener('pointerdown', e => {
      canvas.focus({ preventScroll: true }); canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) { clickStart = { x: e.clientX, y: e.clientY }; moved = false; }
      else { moved = true; gesture = gestureState(); }
    });
    canvas.addEventListener('pointermove', e => {
      const old = pointers.get(e.pointerId); if (!old) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size > 1) {
        const next = gestureState(); if (gesture && next.distance > 5) {
          zoom(Math.log(Math.max(5, gesture.distance) / next.distance));
          orbit.target.x -= (next.x - gesture.x) * orbit.distance / 700; orbit.target.z -= (next.y - gesture.y) * orbit.distance / 700;
        } gesture = next;
      } else {
        if (!moved && Math.hypot(e.clientX - clickStart.x, e.clientY - clickStart.y) < 5) return;
        moved = true; follow = false;
        if (e.buttons === 2 || e.shiftKey) {
          orbit.target.x -= (e.clientX - old.x) * orbit.distance / 700; orbit.target.z -= (e.clientY - old.y) * orbit.distance / 700;
        } else { orbit.azimuth -= (e.clientX - old.x) * .008; orbit.polar = T.MathUtils.clamp(orbit.polar - (e.clientY - old.y) * .006, .001, 1.35); }
      }
      paint();
    });
    canvas.addEventListener('pointerup', e => {
      pointers.delete(e.pointerId); gesture = null;
      if (!moved && e.button === 0) { const hit = hitAt(e.clientX, e.clientY); if (hit) onPick(hit.point, hit.identity); }
    });
    canvas.addEventListener('pointercancel', e => { pointers.delete(e.pointerId); moved = true; gesture = null; });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    canvas.addEventListener('wheel', e => { e.preventDefault(); zoom(T.MathUtils.clamp(e.deltaY * .001, -.3, .3)); }, { passive: false });
    canvas.addEventListener('keydown', e => {
      const delta = { ArrowLeft: -.12, ArrowRight: .12 }[e.key];
      if (delta) { e.preventDefault(); orbit.azimuth += delta; paint(); }
      else if (e.key === '+' || e.key === '=') zoom(-.15);
      else if (e.key === '-') zoom(.15);
      else if (e.key === 'Home') preset('iso');
    });
    const observer = new ResizeObserver(resize); observer.observe(container);
    function project(p) { const v = point(p.x, p.y, p.z || 0).project(camera), b = canvas.getBoundingClientRect(); return { x: b.left + (v.x + 1) * b.width / 2, y: b.top + (1 - v.y) * b.height / 2 }; }
    return { draw, resize, preset, zoom, focus, paint, project,
      setActive(value) { active = value; if (value) resize(); },
      diagnostics() { return { active, objects: objectMeshes.size, robots: robotMeshes.size, calls: renderer.info.render.calls, camera: camera.position.toArray(), follow,
        positions: Object.fromEntries([...robotMeshes].map(([id, m]) => [id, m.group.position.toArray()])) }; },
      dispose() { disposed = true; observer.disconnect(); renderer.dispose(); }
    };
  }
  root.RoboField3D = { create };
})(globalThis);
