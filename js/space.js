/* ========================================
   SPACE JOURNEY — v4
   Scroll = fly through space.
   Each section passes through a different
   region: star field → nebula → galaxy →
   supernova → deep space.
   All particle-based, no solid geometry.
   ======================================== */

(function () {
    'use strict';

    var canvas = document.getElementById('space-canvas');
    if (!canvas || !window.THREE) return;

    var isMobile = /Mobi|Android/i.test(navigator.userAgent) || window.innerWidth < 768;
    var M = isMobile; // shorthand

    // ── Scene ──
    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 8000);
    camera.position.set(0, 0, 0);

    var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: !M, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    var mouse = { x: 0, y: 0, tx: 0, ty: 0 };
    var scrollZ = 0; // how far camera has "flown"
    var clock = new THREE.Clock();

    // ── Helper: point material ──
    function pMat(size, color, opacity, vertexColors) {
        return new THREE.PointsMaterial({
            size: size, color: vertexColors ? undefined : color,
            vertexColors: !!vertexColors, transparent: true, opacity: opacity,
            sizeAttenuation: true, blending: THREE.AdditiveBlending, depthWrite: false
        });
    }

    // ============================================================
    //  1. STAR FIELD — surrounding tube of stars the camera flies through
    // ============================================================
    function makeStarTunnel(count, length, radius) {
        var geo = new THREE.BufferGeometry();
        var pos = new Float32Array(count * 3);
        var col = new Float32Array(count * 3);
        var pal = [[0.75,0.85,1],[1,0.96,0.86],[0.6,0.72,1],[1,0.82,0.65],[0.88,0.75,1]];

        for (var i = 0; i < count; i++) {
            var i3 = i * 3;
            var angle = Math.random() * Math.PI * 2;
            var r = 80 + Math.random() * radius;
            pos[i3]   = Math.cos(angle) * r + (Math.random() - 0.5) * 60;
            pos[i3+1] = Math.sin(angle) * r + (Math.random() - 0.5) * 60;
            pos[i3+2] = -Math.random() * length;
            var c = pal[Math.floor(Math.random() * pal.length)];
            col[i3] = c[0]; col[i3+1] = c[1]; col[i3+2] = c[2];
        }
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
        return new THREE.Points(geo, pMat(1.6, 0, 0.85, true));
    }

    // Distant background stars (static sphere)
    function makeBgStars(count) {
        var geo = new THREE.BufferGeometry();
        var pos = new Float32Array(count * 3);
        var col = new Float32Array(count * 3);
        for (var i = 0; i < count; i++) {
            var i3 = i * 3;
            var theta = Math.random() * Math.PI * 2;
            var phi = Math.acos(2 * Math.random() - 1);
            var r = 3000 + Math.random() * 2000;
            pos[i3]   = r * Math.sin(phi) * Math.cos(theta);
            pos[i3+1] = r * Math.sin(phi) * Math.sin(theta);
            pos[i3+2] = r * Math.cos(phi);
            var b = 0.5 + Math.random() * 0.5;
            col[i3] = b * 0.8; col[i3+1] = b * 0.85; col[i3+2] = b;
        }
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
        return new THREE.Points(geo, pMat(1.2, 0, 0.6, true));
    }

    // ============================================================
    //  2. NEBULA CLOUDS — placed at different depths along the journey
    // ============================================================
    function makeNebulaCloud(cx, cy, cz, count, spread, color, opacity) {
        var geo = new THREE.BufferGeometry();
        var pos = new Float32Array(count * 3);
        for (var i = 0; i < count; i++) {
            var i3 = i * 3;
            var r = spread * (1 - Math.pow(Math.random(), 0.4));
            var th = Math.random() * Math.PI * 2;
            var ph = Math.acos(2 * Math.random() - 1);
            pos[i3]   = r * Math.sin(ph) * Math.cos(th);
            pos[i3+1] = r * Math.sin(ph) * Math.sin(th);
            pos[i3+2] = r * Math.cos(ph);
        }
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        var cloud = new THREE.Points(geo, pMat(M ? 3.5 : 4.5, color, opacity));
        cloud.position.set(cx, cy, cz);
        return cloud;
    }

    // ============================================================
    //  3. SPIRAL GALAXY
    // ============================================================
    function makeGalaxy(cx, cy, cz, count, radius, arms, c1, c2, tilt) {
        var geo = new THREE.BufferGeometry();
        var pos = new Float32Array(count * 3);
        var col = new Float32Array(count * 3);
        var cc1 = new THREE.Color(c1), cc2 = new THREE.Color(c2);

        for (var i = 0; i < count; i++) {
            var i3 = i * 3;
            var r = Math.pow(Math.random(), 0.6) * radius;
            var arm = (i % arms) * (Math.PI * 2 / arms);
            var angle = arm + r * 0.008;
            var sp = r * 0.2;
            pos[i3]   = Math.cos(angle) * r + (Math.random()-0.5) * sp;
            pos[i3+1] = (Math.random()-0.5) * sp * 0.12;
            pos[i3+2] = Math.sin(angle) * r + (Math.random()-0.5) * sp;
            var m = cc1.clone().lerp(cc2, r/radius);
            col[i3] = m.r; col[i3+1] = m.g; col[i3+2] = m.b;
        }
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
        var g = new THREE.Points(geo, pMat(0.9, 0, 0.7, true));
        g.position.set(cx, cy, cz);
        g.rotation.x = tilt || 0;
        return g;
    }

    // ============================================================
    //  4. SUPERNOVA — expanding particle shell + bright core
    // ============================================================
    function makeSupernova(cx, cy, cz, shellRadius) {
        var group = new THREE.Group();
        group.position.set(cx, cy, cz);

        // Core
        var cGeo = new THREE.BufferGeometry();
        var cPos = new Float32Array(80 * 3);
        for (var i = 0; i < 80; i++) {
            cPos[i*3]=(Math.random()-0.5)*5; cPos[i*3+1]=(Math.random()-0.5)*5; cPos[i*3+2]=(Math.random()-0.5)*5;
        }
        cGeo.setAttribute('position', new THREE.BufferAttribute(cPos, 3));
        group.add(new THREE.Points(cGeo, pMat(3.5, 0xffffff, 0.95)));

        // Shell
        var sCount = M ? 200 : 500;
        var sGeo = new THREE.BufferGeometry();
        var sPos = new Float32Array(sCount * 3);
        var sCol = new Float32Array(sCount * 3);
        var cols = [new THREE.Color(0xff6b9d), new THREE.Color(0x38d9ff), new THREE.Color(0xffeedd), new THREE.Color(0x7b73ff)];
        for (var j = 0; j < sCount; j++) {
            var d = shellRadius * (0.3 + Math.random() * 0.7);
            var th = Math.random()*Math.PI*2, ph = Math.acos(2*Math.random()-1);
            sPos[j*3]=d*Math.sin(ph)*Math.cos(th); sPos[j*3+1]=d*Math.sin(ph)*Math.sin(th); sPos[j*3+2]=d*Math.cos(ph);
            var rc = cols[Math.floor(Math.random()*cols.length)];
            sCol[j*3]=rc.r; sCol[j*3+1]=rc.g; sCol[j*3+2]=rc.b;
        }
        sGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
        sGeo.setAttribute('color', new THREE.BufferAttribute(sCol, 3));
        var shell = new THREE.Points(sGeo, pMat(1.8, 0, 0.45, true));
        group.add(shell);
        group.userData.shell = shell;
        return group;
    }

    // ============================================================
    //  5. DUST LANES — thin stretched particle ribbons
    // ============================================================
    function makeDustLane(cx, cy, cz, length, width, count, color, opacity) {
        var geo = new THREE.BufferGeometry();
        var pos = new Float32Array(count * 3);
        for (var i = 0; i < count; i++) {
            pos[i*3]   = (Math.random()-0.5) * width;
            pos[i*3+1] = (Math.random()-0.5) * width * 0.15;
            pos[i*3+2] = (Math.random()-0.5) * length;
        }
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        var lane = new THREE.Points(geo, pMat(1.5, color, opacity));
        lane.position.set(cx, cy, cz);
        return lane;
    }

    // ============================================================
    //  6. SPACESHIP trails
    // ============================================================
    var ships = [];
    function spawnShip(zRange) {
        var tLen = 35;
        var geo = new THREE.BufferGeometry();
        var pos = new Float32Array(tLen * 3);
        var col = new Float32Array(tLen * 3);
        var sx = (Math.random()-0.5) * 300;
        var sy = (Math.random()-0.5) * 200;
        var sz = zRange[0] + Math.random() * (zRange[1] - zRange[0]);
        for (var i = 0; i < tLen; i++) {
            pos[i*3]=sx; pos[i*3+1]=sy; pos[i*3+2]=sz;
            var t=i/tLen; col[i*3]=0.2+(1-t)*0.8; col[i*3+1]=0.85; col[i*3+2]=1;
        }
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
        var trail = new THREE.Points(geo, pMat(2, 0, 0.75, true));
        scene.add(trail);
        var a = Math.random()*Math.PI*2;
        ships.push({ mesh:trail, hx:sx, hy:sy, hz:sz, vx:Math.cos(a)*1.8, vy:(Math.random()-0.5)*0.4, vz:-0.5-Math.random(), life:0, max:250+Math.random()*200 });
    }

    // ============================================================
    //  7. SHOOTING STARS
    // ============================================================
    var meteors = [];
    function spawnMeteor(zNear) {
        var len = 18;
        var geo = new THREE.BufferGeometry();
        var pos = new Float32Array(len * 3);
        var sx = (Math.random()-0.5)*600, sy = 150+Math.random()*300, sz = zNear - Math.random()*400;
        for (var i = 0; i < len; i++) { pos[i*3]=sx-i*2.5; pos[i*3+1]=sy-i*1.2; pos[i*3+2]=sz; }
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        var s = new THREE.Points(geo, pMat(1.5, 0xffffff, 0));
        scene.add(s);
        meteors.push({ mesh:s, speed:9+Math.random()*6, life:0, max:35+Math.random()*25 });
    }

    // ============================================================
    //  BUILD THE JOURNEY — objects placed along the Z axis
    //  Camera starts at z=0 and flies toward -z as user scrolls.
    //  Total journey length ≈ 6000 units.
    // ============================================================
    var JOURNEY_LEN = 6000;

    // Background sky dome (always visible)
    var bgStars = makeBgStars(M ? 2000 : 5000);
    scene.add(bgStars);

    // Tunnel stars wrapping the entire journey
    var tunnel = makeStarTunnel(M ? 4000 : 10000, JOURNEY_LEN + 1000, M ? 500 : 800);
    scene.add(tunnel);

    // ── Zone 1 (z: 0 to -1000) — Hero: Open star field ──
    // Just tunnel + bg, clean and open

    // ── Zone 2 (z: -800 to -2000) — About: Nebula region ──
    var nebulae = [];
    var nConf = [
        { x:-200, y:80,  z:-900,  n:M?200:500, s:180, c:0x7b73ff, o:0.07 },
        { x:250,  y:-60, z:-1300, n:M?180:450, s:220, c:0x38d9ff, o:0.05 },
        { x:-100, y:150, z:-1700, n:M?150:400, s:160, c:0xff7bab, o:0.06 },
        { x:180,  y:-120,z:-2000, n:M?120:350, s:200, c:0x9966ff, o:0.04 },
    ];
    nConf.forEach(function(n) {
        var c = makeNebulaCloud(n.x, n.y, n.z, n.n, n.s, n.c, n.o);
        scene.add(c); nebulae.push(c);
    });

    // Dust lanes weaving through nebula
    if (!M) {
        scene.add(makeDustLane(-150, 30, -1100, 600, 120, 300, 0x5544aa, 0.04));
        scene.add(makeDustLane(100, -50, -1600, 500, 100, 250, 0x3388aa, 0.03));
    }

    // ── Zone 3 (z: -2000 to -3200) — Experience: Galaxy flyby ──
    var galaxy1 = makeGalaxy(-300, 100, -2400, M?1500:4000, 150, 3, 0x7b73ff, 0x38d9ff, Math.PI*0.3);
    scene.add(galaxy1);

    if (!M) {
        var galaxy2 = makeGalaxy(400, -80, -2900, 2000, 100, 2, 0xff7bab, 0x9966ff, Math.PI*0.55);
        scene.add(galaxy2);
    }

    // More nebula depth
    scene.add(makeNebulaCloud(300, 200, -2600, M?100:300, 140, 0x4466cc, 0.03));

    // ── Zone 4 (z: -3200 to -4200) — Skills: Supernova ──
    var supernova1 = makeSupernova(150, 80, -3500, 70);
    scene.add(supernova1);

    if (!M) {
        var supernova2 = makeSupernova(-250, -60, -3900, 45);
        scene.add(supernova2);
    }

    // Asteroid field around supernova
    var astGeo = new THREE.BufferGeometry();
    var astC = M ? 400 : 1000;
    var astP = new Float32Array(astC * 3);
    for (var ai = 0; ai < astC; ai++) {
        var aa = Math.random()*Math.PI*2, ar = 200+Math.random()*150;
        astP[ai*3]=Math.cos(aa)*ar; astP[ai*3+1]=(Math.random()-0.5)*30; astP[ai*3+2]=Math.sin(aa)*ar - 3600;
    }
    astGeo.setAttribute('position', new THREE.BufferAttribute(astP, 3));
    var asteroids = new THREE.Points(astGeo, pMat(1.0, 0x8888aa, 0.35));
    scene.add(asteroids);

    // ── Zone 5 (z: -4200 to -5200) — Projects: Deep nebula ──
    scene.add(makeNebulaCloud(-200, 100, -4500, M?150:400, 200, 0x7b73ff, 0.05));
    scene.add(makeNebulaCloud(200, -80, -4800, M?120:350, 170, 0x00ccaa, 0.04));
    if (!M) {
        scene.add(makeDustLane(0, 0, -4600, 800, 200, 400, 0x443388, 0.03));
        // Small distant galaxy
        scene.add(makeGalaxy(350, 150, -5000, 1000, 60, 2, 0x38d9ff, 0x7b73ff, Math.PI*0.4));
    }

    // ── Zone 6 (z: -5200 to -6000) — Education/Contact: Emerging from deep space ──
    scene.add(makeNebulaCloud(0, 0, -5500, M?100:300, 250, 0x38d9ff, 0.03));
    if (!M) {
        var supernova3 = makeSupernova(-300, 120, -5700, 55);
        scene.add(supernova3);
    }

    // Spawn initial ships spread across journey
    var maxShips = M ? 3 : 6;
    for (var si = 0; si < maxShips; si++) spawnShip([-500, -5500]);

    // ============================================================
    //  ANIMATION
    // ============================================================
    var frame = 0;

    function animate() {
        requestAnimationFrame(animate);
        frame++;
        var elapsed = clock.getElapsedTime();

        // Mouse smoothing
        mouse.x += (mouse.tx - mouse.x) * 0.04;
        mouse.y += (mouse.ty - mouse.y) * 0.04;

        // ── SCROLL → CAMERA Z ──
        var scrollY = window.scrollY || window.pageYOffset;
        var docH = document.documentElement.scrollHeight - window.innerHeight;
        var scrollPct = docH > 0 ? scrollY / docH : 0;
        var targetZ = -scrollPct * JOURNEY_LEN;
        scrollZ += (targetZ - scrollZ) * 0.08; // smooth lerp

        camera.position.z = scrollZ;
        camera.position.x = mouse.x * 30;
        camera.position.y = -mouse.y * 20;
        camera.lookAt(camera.position.x * 0.5, camera.position.y * 0.5, scrollZ - 200);

        // Background stars follow camera loosely (parallax)
        bgStars.position.z = scrollZ * 0.3;

        // ── TWINKLE ──
        if (!M && frame % 3 === 0) {
            var tsz = tunnel.geometry.attributes.size;
            if (!tsz) {
                // Create size attribute if not exists
            } else {
                for (var ti = 0; ti < tsz.count; ti += 15) {
                    tsz.array[ti] = (Math.sin(elapsed * 2.5 + ti * 0.3) * 0.4 + 1) * 1.6;
                }
                tsz.needsUpdate = true;
            }
        }

        // ── NEBULAE drift ──
        nebulae.forEach(function(c, i) {
            c.position.y += Math.sin(elapsed * 0.2 + i * 2.3) * 0.06;
            c.position.x += Math.cos(elapsed * 0.15 + i * 1.8) * 0.04;
            c.rotation.y += 0.0001;
        });

        // ── GALAXIES rotate ──
        if (galaxy1) galaxy1.rotation.y += 0.0004;
        if (!M && galaxy2) galaxy2.rotation.y -= 0.0003;

        // ── SUPERNOVAE pulse ──
        [supernova1, supernova2, !M && supernova3].forEach(function(sn, idx) {
            if (!sn || !sn.userData.shell) return;
            var p = Math.sin(elapsed * 0.6 + idx * 2) * 0.12 + 1;
            sn.scale.set(p, p, p);
            sn.userData.shell.material.opacity = 0.3 + Math.sin(elapsed * 1.0 + idx) * 0.12;
            sn.rotation.y += 0.001;
        });

        // ── ASTEROIDS orbit ──
        asteroids.rotation.y += 0.0003;

        // ── SHIPS ──
        for (var si2 = ships.length - 1; si2 >= 0; si2--) {
            var s = ships[si2]; s.life++;
            s.hx += s.vx; s.hy += s.vy; s.hz += s.vz;
            var sp = s.mesh.geometry.attributes.position.array;
            for (var sj = sp.length/3 - 1; sj > 0; sj--) {
                sp[sj*3]=sp[(sj-1)*3]; sp[sj*3+1]=sp[(sj-1)*3+1]; sp[sj*3+2]=sp[(sj-1)*3+2];
            }
            sp[0]=s.hx; sp[1]=s.hy; sp[2]=s.hz;
            s.mesh.geometry.attributes.position.needsUpdate = true;
            if (s.life > s.max) { scene.remove(s.mesh); s.mesh.geometry.dispose(); s.mesh.material.dispose(); ships.splice(si2, 1); }
        }
        if (frame % 200 === 0 && ships.length < maxShips) spawnShip([scrollZ - 200, scrollZ - 2000]);

        // ── METEORS ──
        for (var mi = meteors.length - 1; mi >= 0; mi--) {
            var m = meteors[mi]; m.life++;
            var mp = m.mesh.geometry.attributes.position.array;
            for (var mk = 0; mk < mp.length/3; mk++) { mp[mk*3] += m.speed; mp[mk*3+1] -= m.speed*0.4; }
            m.mesh.geometry.attributes.position.needsUpdate = true;
            var prog = m.life / m.max;
            m.mesh.material.opacity = prog<0.15 ? prog/0.15*0.8 : prog>0.7 ? (1-prog)/0.3*0.8 : 0.8;
            if (m.life > m.max) { scene.remove(m.mesh); m.mesh.geometry.dispose(); m.mesh.material.dispose(); meteors.splice(mi, 1); }
        }
        if (frame % 70 === 0 && meteors.length < 3) spawnMeteor(scrollZ);

        renderer.render(scene, camera);
    }

    animate();

    // ── Events ──
    if (!M) {
        document.addEventListener('mousemove', function(e) {
            mouse.tx = (e.clientX / window.innerWidth - 0.5) * 2;
            mouse.ty = (e.clientY / window.innerHeight - 0.5) * 2;
        });
    }
    window.addEventListener('resize', function() {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });
})();
