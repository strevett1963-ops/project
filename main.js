(function () {
  "use strict";

  var statusEl = document.getElementById("status");
  var playerHealthEl = document.getElementById("playerHealth");
  var enemyHealthEl = document.getElementById("enemyHealth");
  var overlayEl = document.getElementById("overlay");
  var messageEl = document.getElementById("message");
  var summaryEl = document.getElementById("summary");
  var restartButton = document.getElementById("restart");

  if (!window.THREE) {
    statusEl.textContent = "Three.js could not be loaded.";
    messageEl.textContent = "Unable to start";
    summaryEl.textContent = "The 3D library failed to load. Check your connection and refresh.";
    return;
  }

  var ARENA_HALF_SIZE = 24;
  var PLAYER_HEIGHT = 1.7;
  var PLAYER_SPEED = 8.2;
  var TURN_SPEED = 2.65;
  var PLAYER_SHOT_COOLDOWN = 0.28;
  var ENEMY_SPEED = 3.2;
  var ENEMY_MIN_SHOT_DELAY = 0.95;
  var ENEMY_MAX_SHOT_DELAY = 1.55;

  var scene;
  var camera;
  var renderer;
  var clock;
  var raycaster = new THREE.Raycaster();
  var keys = new Set();
  var enemyMeshes = [];
  var shotEffects = [];

  var state = {
    playing: false,
    ended: false,
    lastPlayerShot: -Infinity,
    statusTimer: 0,
    player: {
      health: 100,
      yaw: 0,
      position: new THREE.Vector3(0, PLAYER_HEIGHT, 15)
    },
    enemy: {
      health: 100,
      nextShotAt: 0,
      group: null,
      phase: Math.random() * Math.PI * 2
    }
  };

  var forward = new THREE.Vector3();
  var toPlayer = new THREE.Vector3();
  var desiredMove = new THREE.Vector3();
  var tempVector = new THREE.Vector3();

  init();

  function init() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x08111f);
    scene.fog = new THREE.Fog(0x08111f, 24, 68);

    camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.08, 120);
    scene.add(camera);
    camera.add(createWeapon());

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.body.appendChild(renderer.domElement);

    clock = new THREE.Clock();

    createArena();
    state.enemy.group = createEnemy();
    scene.add(state.enemy.group);

    resetGame(false);
    bindEvents();
    animate();
  }

  function bindEvents() {
    window.addEventListener("resize", onResize);

    window.addEventListener("keydown", function (event) {
      if (isGameKey(event.code)) {
        event.preventDefault();
        keys.add(event.code);
      }

      if ((event.code === "Enter" || event.code === "Space") && !state.playing) {
        event.preventDefault();
        startGame();
      }
    });

    window.addEventListener("keyup", function (event) {
      if (isGameKey(event.code)) {
        event.preventDefault();
        keys.delete(event.code);
      }
    });

    restartButton.addEventListener("click", startGame);
  }

  function isGameKey(code) {
    return code === "ArrowUp" || code === "ArrowDown" || code === "ArrowLeft" ||
      code === "ArrowRight" || code === "Space";
  }

  function startGame() {
    resetGame(true);
    overlayEl.classList.add("hidden");
    restartButton.textContent = "Restart";
    setStatus("Fight! Track the red opponent and fire with Space.", 1.4);
  }

  function resetGame(playing) {
    state.playing = playing;
    state.ended = false;
    state.player.health = 100;
    state.player.yaw = 0;
    state.player.position.set(0, PLAYER_HEIGHT, 15);
    state.enemy.health = 100;
    state.enemy.group.position.set(0, 0, -13);
    state.enemy.nextShotAt = performance.now() / 1000 + 1.1;
    state.lastPlayerShot = -Infinity;
    state.statusTimer = 0;
    keys.clear();

    while (shotEffects.length) {
      scene.remove(shotEffects.pop().line);
    }

    updateCamera();
    updateHud();

    if (!playing) {
      statusEl.textContent = "Press Start Game to enter the arena.";
    }
  }

  function createArena() {
    var hemiLight = new THREE.HemisphereLight(0xb8d8ff, 0x17202b, 1.15);
    scene.add(hemiLight);

    var keyLight = new THREE.DirectionalLight(0xffffff, 1.8);
    keyLight.position.set(9, 18, 8);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.camera.left = -32;
    keyLight.shadow.camera.right = 32;
    keyLight.shadow.camera.top = 32;
    keyLight.shadow.camera.bottom = -32;
    scene.add(keyLight);

    var floorMaterial = new THREE.MeshStandardMaterial({
      color: 0x13233a,
      roughness: 0.8,
      metalness: 0.18
    });
    var floor = new THREE.Mesh(
      new THREE.PlaneGeometry(ARENA_HALF_SIZE * 2, ARENA_HALF_SIZE * 2),
      floorMaterial
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    var grid = new THREE.GridHelper(ARENA_HALF_SIZE * 2, 24, 0x48c7ff, 0x244467);
    grid.position.y = 0.01;
    scene.add(grid);

    var wallMaterial = new THREE.MeshStandardMaterial({
      color: 0x1c3557,
      emissive: 0x061424,
      roughness: 0.55,
      metalness: 0.35
    });
    addWall(0, 2, -ARENA_HALF_SIZE, ARENA_HALF_SIZE * 2, 4, 1, wallMaterial);
    addWall(0, 2, ARENA_HALF_SIZE, ARENA_HALF_SIZE * 2, 4, 1, wallMaterial);
    addWall(-ARENA_HALF_SIZE, 2, 0, 1, 4, ARENA_HALF_SIZE * 2, wallMaterial);
    addWall(ARENA_HALF_SIZE, 2, 0, 1, 4, ARENA_HALF_SIZE * 2, wallMaterial);

    addNeonStrip(0, 3.2, -ARENA_HALF_SIZE + 0.55, ARENA_HALF_SIZE * 1.6, 0.06, 0.06, 0x39a9ff);
    addNeonStrip(0, 3.2, ARENA_HALF_SIZE - 0.55, ARENA_HALF_SIZE * 1.6, 0.06, 0.06, 0x2df3a3);
    addNeonStrip(-ARENA_HALF_SIZE + 0.55, 3.2, 0, 0.06, 0.06, ARENA_HALF_SIZE * 1.6, 0xff315f);
    addNeonStrip(ARENA_HALF_SIZE - 0.55, 3.2, 0, 0.06, 0.06, ARENA_HALF_SIZE * 1.6, 0xffb347);

    for (var i = 0; i < 12; i += 1) {
      var angle = (i / 12) * Math.PI * 2;
      var radius = 16;
      var marker = new THREE.Mesh(
        new THREE.BoxGeometry(0.42, 0.42, 0.42),
        new THREE.MeshStandardMaterial({ color: 0x3b5f88, emissive: 0x071b2e })
      );
      marker.position.set(Math.cos(angle) * radius, 0.22, Math.sin(angle) * radius);
      marker.castShadow = true;
      scene.add(marker);
    }
  }

  function addWall(x, y, z, width, height, depth, material) {
    var wall = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
    wall.position.set(x, y, z);
    wall.castShadow = true;
    wall.receiveShadow = true;
    scene.add(wall);
  }

  function addNeonStrip(x, y, z, width, height, depth, color) {
    var strip = new THREE.Mesh(
      new THREE.BoxGeometry(width, height, depth),
      new THREE.MeshBasicMaterial({ color: color })
    );
    strip.position.set(x, y, z);
    scene.add(strip);
  }

  function createWeapon() {
    var weapon = new THREE.Group();

    var body = new THREE.Mesh(
      new THREE.BoxGeometry(0.24, 0.18, 0.58),
      new THREE.MeshStandardMaterial({ color: 0x1a2633, roughness: 0.45, metalness: 0.65 })
    );
    body.position.set(0.34, -0.28, -0.62);
    weapon.add(body);

    var barrel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.045, 0.055, 0.62, 16),
      new THREE.MeshStandardMaterial({ color: 0x7fb7d8, roughness: 0.28, metalness: 0.85 })
    );
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0.34, -0.25, -0.95);
    weapon.add(barrel);

    var grip = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 0.34, 0.16),
      new THREE.MeshStandardMaterial({ color: 0x0c1118, roughness: 0.7, metalness: 0.35 })
    );
    grip.rotation.x = -0.25;
    grip.position.set(0.34, -0.47, -0.46);
    weapon.add(grip);

    return weapon;
  }

  function createEnemy() {
    var group = new THREE.Group();
    var bodyMaterial = new THREE.MeshStandardMaterial({
      color: 0xd81945,
      emissive: 0x26040d,
      roughness: 0.35,
      metalness: 0.25
    });
    var darkMaterial = new THREE.MeshStandardMaterial({
      color: 0x151923,
      roughness: 0.45,
      metalness: 0.55
    });

    var body = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.7, 1.65, 24), bodyMaterial);
    body.position.y = 1.05;
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);
    enemyMeshes.push(body);

    var head = new THREE.Mesh(new THREE.SphereGeometry(0.45, 24, 16), bodyMaterial);
    head.position.y = 2.12;
    head.castShadow = true;
    group.add(head);
    enemyMeshes.push(head);

    var visor = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.16, 0.07), darkMaterial);
    visor.position.set(0, 2.18, -0.4);
    group.add(visor);

    var blaster = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.95, 12), darkMaterial);
    blaster.rotation.x = Math.PI / 2;
    blaster.position.set(0.44, 1.36, -0.58);
    group.add(blaster);

    return group;
  }

  function animate() {
    requestAnimationFrame(animate);

    var dt = Math.min(clock.getDelta(), 0.033);
    if (state.playing) {
      updatePlayer(dt);
      updateEnemy(dt);
      updateCombat(dt);
    }
    updateShotEffects(dt);
    updateStatusTimer(dt);

    renderer.render(scene, camera);
  }

  function updatePlayer(dt) {
    if (keys.has("ArrowLeft")) {
      state.player.yaw += TURN_SPEED * dt;
    }
    if (keys.has("ArrowRight")) {
      state.player.yaw -= TURN_SPEED * dt;
    }

    var moveAmount = 0;
    if (keys.has("ArrowUp")) {
      moveAmount += PLAYER_SPEED * dt;
    }
    if (keys.has("ArrowDown")) {
      moveAmount -= PLAYER_SPEED * dt;
    }

    if (moveAmount !== 0) {
      getForwardVector().multiplyScalar(moveAmount);
      state.player.position.x += forward.x;
      state.player.position.z += forward.z;
      clampToArena(state.player.position, 1.25);
    }

    updateCamera();
  }

  function updateEnemy(dt) {
    toPlayer.set(
      state.player.position.x - state.enemy.group.position.x,
      0,
      state.player.position.z - state.enemy.group.position.z
    );
    var distance = Math.max(toPlayer.length(), 0.001);
    var directionToPlayer = toPlayer.clone().divideScalar(distance);
    var now = performance.now() / 1000;

    desiredMove.set(0, 0, 0);
    if (distance > 11) {
      desiredMove.add(directionToPlayer);
    } else if (distance < 6.5) {
      desiredMove.addScaledVector(directionToPlayer, -1);
    }

    tempVector.set(-directionToPlayer.z, 0, directionToPlayer.x);
    desiredMove.addScaledVector(tempVector, Math.sin(now * 2.1 + state.enemy.phase) * 0.9);

    if (desiredMove.lengthSq() > 0.001) {
      desiredMove.normalize().multiplyScalar(ENEMY_SPEED * dt);
      state.enemy.group.position.add(desiredMove);
      clampToArena(state.enemy.group.position, 1.3);
    }

    state.enemy.group.lookAt(state.player.position.x, 1.25, state.player.position.z);
  }

  function updateCombat() {
    var now = performance.now() / 1000;
    if (keys.has("Space")) {
      shootPlayerWeapon(now);
    }

    if (now >= state.enemy.nextShotAt) {
      shootEnemyWeapon(now);
      state.enemy.nextShotAt = now + randomBetween(ENEMY_MIN_SHOT_DELAY, ENEMY_MAX_SHOT_DELAY);
    }
  }

  function shootPlayerWeapon(now) {
    if (now - state.lastPlayerShot < PLAYER_SHOT_COOLDOWN || state.ended) {
      return;
    }

    state.lastPlayerShot = now;
    var origin = camera.position.clone();
    var direction = getForwardVector().clone();
    raycaster.set(origin, direction);
    raycaster.far = 46;

    var hits = raycaster.intersectObjects(enemyMeshes, false);
    var end = origin.clone().addScaledVector(direction, 46);

    if (hits.length > 0) {
      end.copy(hits[0].point);
      state.enemy.health = Math.max(0, state.enemy.health - 25);
      updateHud();

      if (state.enemy.health <= 0) {
        createShotEffect(origin, end, 0x8ef9ff, 0.2);
        endGame(true);
        return;
      }

      setStatus("Hit confirmed. Opponent armor at " + state.enemy.health + "%.", 0.8);
    } else {
      setStatus("Shot missed. Keep the crosshair on the opponent.", 0.55);
    }

    createShotEffect(origin, end, 0x8ef9ff, 0.15);
  }

  function shootEnemyWeapon(now) {
    if (state.ended) {
      return;
    }

    var origin = state.enemy.group.position.clone();
    origin.y = 1.48;

    var target = state.player.position.clone();
    var distance = origin.distanceTo(target);
    var aimSpread = Math.min(1.15, distance * 0.022);
    target.x += randomBetween(-aimSpread, aimSpread);
    target.y += randomBetween(-aimSpread * 0.45, aimSpread * 0.45);
    target.z += randomBetween(-aimSpread, aimSpread);

    var direction = target.clone().sub(origin).normalize();
    var toActualPlayer = state.player.position.clone().sub(origin);
    var projected = THREE.MathUtils.clamp(toActualPlayer.dot(direction), 0, 48);
    var closestPoint = origin.clone().addScaledVector(direction, projected);
    var missDistance = closestPoint.distanceTo(state.player.position);
    var end = origin.clone().addScaledVector(direction, Math.min(48, distance + 2));

    if (missDistance < 0.78 && distance < 42) {
      state.player.health = Math.max(0, state.player.health - 12);
      updateHud();
      setStatus("You were hit! Keep moving to throw off the computer.", 0.9);

      if (state.player.health <= 0) {
        createShotEffect(origin, state.player.position.clone(), 0xff315f, 0.22);
        endGame(false);
        return;
      }
    } else {
      setStatus("Enemy shot missed.", 0.45);
    }

    createShotEffect(origin, end, 0xff315f, 0.18);
  }

  function createShotEffect(start, end, color, life) {
    var geometry = new THREE.BufferGeometry().setFromPoints([start, end]);
    var material = new THREE.LineBasicMaterial({
      color: color,
      transparent: true,
      opacity: 1
    });
    var line = new THREE.Line(geometry, material);
    scene.add(line);
    shotEffects.push({ line: line, life: life, maxLife: life });
  }

  function updateShotEffects(dt) {
    for (var i = shotEffects.length - 1; i >= 0; i -= 1) {
      var effect = shotEffects[i];
      effect.life -= dt;
      effect.line.material.opacity = Math.max(effect.life / effect.maxLife, 0);

      if (effect.life <= 0) {
        scene.remove(effect.line);
        effect.line.geometry.dispose();
        effect.line.material.dispose();
        shotEffects.splice(i, 1);
      }
    }
  }

  function updateStatusTimer(dt) {
    if (!state.playing || state.statusTimer <= 0) {
      return;
    }

    state.statusTimer -= dt;
    if (state.statusTimer <= 0) {
      var distance = state.player.position.distanceTo(state.enemy.group.position);
      statusEl.textContent = "Opponent range: " + Math.round(distance) + "m";
    }
  }

  function setStatus(text, seconds) {
    if (state.ended) {
      return;
    }

    statusEl.textContent = text;
    state.statusTimer = seconds;
  }

  function endGame(playerWon) {
    state.playing = false;
    state.ended = true;
    keys.clear();
    updateHud();

    if (playerWon) {
      statusEl.textContent = "Victory!";
      messageEl.textContent = "You Win";
      summaryEl.textContent = "The computer opponent is down. Restart to try for a cleaner run.";
    } else {
      statusEl.textContent = "Defeated";
      messageEl.textContent = "Game Over";
      summaryEl.textContent = "The computer opponent won this round. Use movement between shots to survive longer.";
    }

    restartButton.textContent = "Play Again";
    overlayEl.classList.remove("hidden");
  }

  function updateHud() {
    playerHealthEl.style.width = state.player.health + "%";
    enemyHealthEl.style.width = state.enemy.health + "%";
  }

  function updateCamera() {
    camera.position.copy(state.player.position);
    camera.rotation.set(0, state.player.yaw, 0);
  }

  function getForwardVector() {
    forward.set(-Math.sin(state.player.yaw), 0, -Math.cos(state.player.yaw));
    return forward.normalize();
  }

  function clampToArena(position, padding) {
    var limit = ARENA_HALF_SIZE - padding;
    position.x = THREE.MathUtils.clamp(position.x, -limit, limit);
    position.z = THREE.MathUtils.clamp(position.z, -limit, limit);
  }

  function randomBetween(min, max) {
    return min + Math.random() * (max - min);
  }

  function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }
}());
