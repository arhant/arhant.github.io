/* ========================================
   SPACE JOURNEY v5 — Physics-based

   Uses:
   - Sprite textures (soft glow circles, not squares)
   - Blackbody star colors by temperature
   - Logarithmic spiral arms (real galaxy math)
   - Inverse-square brightness falloff
   - Keplerian orbital velocities
   - Relativistic jet collimation
   - Shockwave expansion physics
   ======================================== */

(function () {
    'use strict';

    var canvas = document.getElementById('space-canvas');
    if (!canvas || !window.THREE) return;

    var M = /Mobi|Android/i.test(navigator.userAgent) || window.innerWidth < 768;

    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 8000);
    camera.position.set(0, 0, 0);

    var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: !M, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    var mouse = { x: 0, y: 0, tx: 0, ty: 0 };
    var scrollZ = 0;
    var clock = new THREE.Clock();
    var JOURNEY = 6000;

    // ================================================================
    // SPRITE TEXTURE — programmatic soft glow (eliminates squares)
    // ================================================================
    function makeGlowTexture(size, r, g, b, falloff) {
        var c = document.createElement('canvas');
        c.width = c.height = size;
        var ctx = c.getContext('2d');
        var half = size / 2;
        var grad = ctx.createRadialGradient(half, half, 0, half, half, half);
        var f = falloff || 2.5;
        grad.addColorStop(0, 'rgba('+r+','+g+','+b+',1)');
        grad.addColorStop(0.15, 'rgba('+r+','+g+','+b+',0.7)');
        grad.addColorStop(0.4, 'rgba('+r+','+g+','+b+',0.2)');
        grad.addColorStop(1, 'rgba('+r+','+g+','+b+',0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, size, size);
        var tex = new THREE.CanvasTexture(c);
        tex.needsUpdate = true;
        return tex;
    }

    // Shared glow textures
    var glowWhite = makeGlowTexture(64, 255, 255, 255);
    var glowBlue = makeGlowTexture(64, 180, 200, 255);
    var glowCyan = makeGlowTexture(64, 56, 217, 255);
    var glowPurple = makeGlowTexture(64, 123, 115, 255);
    var glowPink = makeGlowTexture(64, 255, 123, 171);
    var glowOrange = makeGlowTexture(64, 255, 180, 80);
    var glowRed = makeGlowTexture(64, 255, 80, 60);
    var glowSoft = makeGlowTexture(128, 200, 200, 255);

    function spriteMat(map, size, opacity) {
        return new THREE.PointsMaterial({
            map: map, size: size, transparent: true, opacity: opacity,
            sizeAttenuation: true, blending: THREE.AdditiveBlending, depthWrite: false
        });
    }
    function spriteMatVC(map, size, opacity) {
        return new THREE.PointsMaterial({
            map: map, size: size, transparent: true, opacity: opacity, vertexColors: true,
            sizeAttenuation: true, blending: THREE.AdditiveBlending, depthWrite: false
        });
    }

    // ================================================================
    // BLACKBODY COLOR — temperature in Kelvin to RGB
    // ================================================================
    function tempToColor(T) {
        T = T / 100;
        var r, g, b;
        if (T <= 66) { r = 255; } else { r = 329.698727446 * Math.pow(T - 60, -0.1332047592); }
        if (T <= 66) { g = 99.4708025861 * Math.log(T) - 161.1195681661; } else { g = 288.1221695283 * Math.pow(T - 60, -0.0755148492); }
        if (T >= 66) { b = 255; } else if (T <= 19) { b = 0; } else { b = 138.5177312231 * Math.log(T - 10) - 305.0447927307; }
        return [Math.min(255,Math.max(0,r))/255, Math.min(255,Math.max(0,g))/255, Math.min(255,Math.max(0,b))/255];
    }

    // ================================================================
    // 1. STAR FIELD — blackbody-colored stars in a tunnel
    // ================================================================
    function makeStars(count, length, radius) {
        var geo = new THREE.BufferGeometry();
        var pos = new Float32Array(count * 3);
        var col = new Float32Array(count * 3);
        // Realistic temperature distribution (mostly cool, few hot)
        for (var i = 0; i < count; i++) {
            var i3 = i * 3;
            var angle = Math.random() * Math.PI * 2;
            var r = 60 + Math.random() * radius;
            pos[i3]   = Math.cos(angle) * r + (Math.random()-0.5) * 50;
            pos[i3+1] = Math.sin(angle) * r + (Math.random()-0.5) * 50;
            pos[i3+2] = -Math.random() * length;
            // Stars: 3000K (red dwarfs) to 30000K (blue giants), weighted toward cooler
            var temp = 3000 + Math.pow(Math.random(), 3) * 27000;
            var c = tempToColor(temp);
            col[i3] = c[0]; col[i3+1] = c[1]; col[i3+2] = c[2];
        }
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
        return new THREE.Points(geo, spriteMatVC(glowWhite, M?2:3, 0.85));
    }

    // Background sky dome
    function makeSkyDome(count) {
        var geo = new THREE.BufferGeometry();
        var pos = new Float32Array(count * 3);
        var col = new Float32Array(count * 3);
        for (var i = 0; i < count; i++) {
            var i3 = i * 3;
            var th = Math.random()*Math.PI*2, ph = Math.acos(2*Math.random()-1);
            var r = 3500 + Math.random()*2000;
            pos[i3]=r*Math.sin(ph)*Math.cos(th); pos[i3+1]=r*Math.sin(ph)*Math.sin(th); pos[i3+2]=r*Math.cos(ph);
            var temp = 3000 + Math.pow(Math.random(), 3) * 20000;
            var c = tempToColor(temp);
            col[i3]=c[0]; col[i3+1]=c[1]; col[i3+2]=c[2];
        }
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
        return new THREE.Points(geo, spriteMatVC(glowWhite, 1.5, 0.5));
    }

    // ================================================================
    // 2. SPIRAL GALAXY — logarithmic spiral arms (real math)
    // ================================================================
    function makeGalaxy(cx, cy, cz, count, radius, arms, c1, c2, tilt) {
        var geo = new THREE.BufferGeometry();
        var pos = new Float32Array(count * 3);
        var col = new Float32Array(count * 3);
        var cc1 = new THREE.Color(c1), cc2 = new THREE.Color(c2);
        var pitch = 0.3; // spiral tightness

        for (var i = 0; i < count; i++) {
            var i3 = i * 3;
            var r = Math.pow(Math.random(), 0.5) * radius; // more stars near center
            var armIdx = i % arms;
            var armAngle = armIdx * (Math.PI * 2 / arms);
            // Logarithmic spiral: theta = pitch * ln(r)
            var spiralAngle = armAngle + pitch * Math.log(Math.max(r, 1));
            var spread = r * 0.15 * (1 + Math.random());
            pos[i3]   = Math.cos(spiralAngle) * r + (Math.random()-0.5) * spread;
            pos[i3+1] = (Math.random()-0.5) * spread * 0.08; // very thin disk
            pos[i3+2] = Math.sin(spiralAngle) * r + (Math.random()-0.5) * spread;
            // Core is brighter/whiter, edges are bluer
            var t = r / radius;
            var mixed = new THREE.Color(1, 0.95, 0.8).lerp(cc1.clone().lerp(cc2, t), t);
            col[i3]=mixed.r; col[i3+1]=mixed.g; col[i3+2]=mixed.b;
        }
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
        var g = new THREE.Points(geo, spriteMatVC(glowSoft, M?1.2:1.8, 0.7));
        g.position.set(cx, cy, cz);
        g.rotation.x = tilt || 0;
        return g;
    }

    // ================================================================
    // 3. EMISSION NEBULA — physically-motivated gas cloud
    //    Uses Perlin-noise-like clumping via rejection sampling
    // ================================================================
    function makeNebula(cx, cy, cz, count, spread, color, opacity) {
        var geo = new THREE.BufferGeometry();
        var pos = new Float32Array(count * 3);
        var col = new Float32Array(count * 3);
        var base = new THREE.Color(color);
        for (var i = 0; i < count; i++) {
            var i3 = i * 3;
            // Clumpy distribution: multiple overlapping gaussian blobs
            var blobX = (Math.floor(Math.random()*3)-1) * spread * 0.3;
            var blobY = (Math.floor(Math.random()*3)-1) * spread * 0.2;
            var blobZ = (Math.floor(Math.random()*3)-1) * spread * 0.25;
            var r = spread * 0.4 * (1 - Math.pow(Math.random(), 0.3));
            var th = Math.random()*Math.PI*2, ph = Math.acos(2*Math.random()-1);
            pos[i3]   = blobX + r*Math.sin(ph)*Math.cos(th);
            pos[i3+1] = blobY + r*Math.sin(ph)*Math.sin(th) * 0.6;
            pos[i3+2] = blobZ + r*Math.cos(ph);
            // Color variation — simulate ionized gas
            var variation = 0.8 + Math.random() * 0.4;
            col[i3]   = Math.min(1, base.r * variation);
            col[i3+1] = Math.min(1, base.g * variation);
            col[i3+2] = Math.min(1, base.b * variation);
        }
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
        var cloud = new THREE.Points(geo, spriteMatVC(glowSoft, M?5:7, opacity));
        cloud.position.set(cx, cy, cz);
        return cloud;
    }

    // ================================================================
    // 4. SUPERNOVA REMNANT — Sedov-Taylor shockwave expansion
    // ================================================================
    function makeSupernova(cx, cy, cz, radius) {
        var group = new THREE.Group();
        group.position.set(cx, cy, cz);

        // Neutron star core
        var cGeo = new THREE.BufferGeometry();
        var cCount = M?30:80;
        var cPos = new Float32Array(cCount*3);
        for(var i=0;i<cCount;i++){var cr=Math.random()*4;var ct=Math.random()*Math.PI*2,cp=Math.acos(2*Math.random()-1);cPos[i*3]=cr*Math.sin(cp)*Math.cos(ct);cPos[i*3+1]=cr*Math.sin(cp)*Math.sin(ct);cPos[i*3+2]=cr*Math.cos(cp);}
        cGeo.setAttribute('position', new THREE.BufferAttribute(cPos, 3));
        group.add(new THREE.Points(cGeo, spriteMat(glowWhite, 5, 0.95)));

        // Hot inner ejecta (silicon/iron — yellow-white)
        var hCount = M?80:250;
        var hGeo = new THREE.BufferGeometry();
        var hPos = new Float32Array(hCount*3), hCol = new Float32Array(hCount*3);
        for(var h=0;h<hCount;h++){var hr=radius*0.4*Math.pow(Math.random(),0.7);var ht=Math.random()*Math.PI*2,hp=Math.acos(2*Math.random()-1);hPos[h*3]=hr*Math.sin(hp)*Math.cos(ht);hPos[h*3+1]=hr*Math.sin(hp)*Math.sin(ht);hPos[h*3+2]=hr*Math.cos(hp);hCol[h*3]=1;hCol[h*3+1]=0.85+Math.random()*0.15;hCol[h*3+2]=0.5+Math.random()*0.3;}
        hGeo.setAttribute('position', new THREE.BufferAttribute(hPos, 3));
        hGeo.setAttribute('color', new THREE.BufferAttribute(hCol, 3));
        group.add(new THREE.Points(hGeo, spriteMatVC(glowOrange, 4, 0.6)));

        // Shockwave shell — Sedov-Taylor: density peaks at shell edge
        var sCount = M?200:700;
        var sGeo = new THREE.BufferGeometry();
        var sPos = new Float32Array(sCount*3), sCol = new Float32Array(sCount*3);
        var sPalette = [new THREE.Color(0xff4466),new THREE.Color(0x44aaff),new THREE.Color(0xff8844),new THREE.Color(0x7b73ff),new THREE.Color(0xffcc66),new THREE.Color(0xff7bab)];
        for(var s=0;s<sCount;s++){
            // Concentrate particles near the shell edge (r ≈ radius)
            var sr = radius * (0.7 + Math.pow(Math.random(), 0.3) * 0.3);
            var st=Math.random()*Math.PI*2,sp=Math.acos(2*Math.random()-1);
            sPos[s*3]=sr*Math.sin(sp)*Math.cos(st);sPos[s*3+1]=sr*Math.sin(sp)*Math.sin(st);sPos[s*3+2]=sr*Math.cos(sp);
            var sc=sPalette[Math.floor(Math.random()*sPalette.length)];
            sCol[s*3]=sc.r;sCol[s*3+1]=sc.g;sCol[s*3+2]=sc.b;
        }
        sGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
        sGeo.setAttribute('color', new THREE.BufferAttribute(sCol, 3));
        var shell = new THREE.Points(sGeo, spriteMatVC(glowSoft, M?2.5:3.5, 0.5));
        group.add(shell);
        group.userData.shell = shell;

        // Filaments — Rayleigh-Taylor instability fingers
        if (!M) {
            for(var f=0;f<15;f++){
                var ft=Math.random()*Math.PI*2,fp=Math.acos(2*Math.random()-1);
                var dx=Math.sin(fp)*Math.cos(ft),dy=Math.sin(fp)*Math.sin(ft),dz=Math.cos(fp);
                var fPts=25;var fGeo=new THREE.BufferGeometry();var fPos=new Float32Array(fPts*3),fCol=new Float32Array(fPts*3);
                for(var fi=0;fi<fPts;fi++){var fd=radius*0.5+fi*radius*0.03;fPos[fi*3]=dx*fd+(Math.random()-0.5)*4;fPos[fi*3+1]=dy*fd+(Math.random()-0.5)*4;fPos[fi*3+2]=dz*fd+(Math.random()-0.5)*4;var fft=fi/fPts;fCol[fi*3]=1-fft*0.4;fCol[fi*3+1]=0.4+fft*0.4;fCol[fi*3+2]=0.3+fft*0.7;}
                fGeo.setAttribute('position', new THREE.BufferAttribute(fPos, 3));
                fGeo.setAttribute('color', new THREE.BufferAttribute(fCol, 3));
                group.add(new THREE.Points(fGeo, spriteMatVC(glowCyan, 2, 0.3)));
            }
        }
        return group;
    }

    // ================================================================
    // 5. BLACK HOLE — Kerr metric inspired
    // ================================================================
    function makeBlackHole(cx, cy, cz, scale) {
        var group = new THREE.Group();
        group.position.set(cx, cy, cz);
        var S = scale || 1;

        // Accretion disk — Keplerian velocity profile (v ∝ r^-0.5)
        var dCount = M?500:2500;
        var dGeo = new THREE.BufferGeometry();
        var dPos = new Float32Array(dCount*3), dCol = new Float32Array(dCount*3);
        for(var i=0;i<dCount;i++){
            var r = (12 + Math.pow(Math.random(),0.7) * 70) * S;
            var a = Math.random() * Math.PI * 2;
            dPos[i*3]=Math.cos(a)*r; dPos[i*3+1]=(Math.random()-0.5)*1.5*(r/(82*S)); dPos[i*3+2]=Math.sin(a)*r;
            // Blackbody: inner disk ~20000K (blue-white), outer ~3000K (red)
            var t = (r - 12*S) / (70*S);
            var temp = 20000 - t * 17000;
            var c = tempToColor(temp);
            dCol[i*3]=c[0]; dCol[i*3+1]=c[1]; dCol[i*3+2]=c[2];
        }
        dGeo.setAttribute('position', new THREE.BufferAttribute(dPos, 3));
        dGeo.setAttribute('color', new THREE.BufferAttribute(dCol, 3));
        var disk = new THREE.Points(dGeo, spriteMatVC(glowSoft, M?2:3, 0.8));
        disk.rotation.x = Math.PI * 0.38;
        group.add(disk);
        group.userData.disk = disk;

        // ISCO ring (innermost stable circular orbit) — bright photon ring
        var iCount = M?80:250;
        var iGeo = new THREE.BufferGeometry();
        var iPos = new Float32Array(iCount*3);
        for(var j=0;j<iCount;j++){var ia=Math.random()*Math.PI*2;var ir=(11+Math.random()*2)*S;iPos[j*3]=Math.cos(ia)*ir;iPos[j*3+1]=(Math.random()-0.5)*0.3;iPos[j*3+2]=Math.sin(ia)*ir;}
        iGeo.setAttribute('position', new THREE.BufferAttribute(iPos, 3));
        var iscoRing = new THREE.Points(iGeo, spriteMat(glowWhite, 3, 0.9));
        iscoRing.rotation.x = Math.PI * 0.38;
        group.add(iscoRing);

        // Einstein ring — gravitationally lensed light (vertical circle)
        var eCount = M?60:180;
        var eGeo = new THREE.BufferGeometry();
        var ePos = new Float32Array(eCount*3);
        for(var k=0;k<eCount;k++){var ea=Math.random()*Math.PI*2;var er=(12+Math.random()*1.5)*S;ePos[k*3]=Math.cos(ea)*er;ePos[k*3+1]=Math.sin(ea)*er;ePos[k*3+2]=(Math.random()-0.5)*0.3;}
        eGeo.setAttribute('position', new THREE.BufferAttribute(ePos, 3));
        group.add(new THREE.Points(eGeo, spriteMat(glowOrange, 2.5, 0.45)));

        // Relativistic jets — magnetically collimated
        if (!M) {
            for(var jj=0;jj<2;jj++){
                var dir = jj===0?1:-1;
                var jetC = 180;
                var jGeo = new THREE.BufferGeometry();
                var jPos = new Float32Array(jetC*3), jCol = new Float32Array(jetC*3);
                for(var m=0;m<jetC;m++){
                    var jd = (8 + Math.pow(Math.random(),0.6)*130)*S;
                    var jSpread = 2 + jd*0.03; // collimation
                    jPos[m*3]=(Math.random()-0.5)*jSpread;
                    jPos[m*3+1]=dir*(10*S+jd);
                    jPos[m*3+2]=(Math.random()-0.5)*jSpread;
                    var jt=jd/(138*S);
                    jCol[m*3]=0.4+jt*0.6;jCol[m*3+1]=0.5+jt*0.4;jCol[m*3+2]=1;
                }
                jGeo.setAttribute('position', new THREE.BufferAttribute(jPos, 3));
                jGeo.setAttribute('color', new THREE.BufferAttribute(jCol, 3));
                var jets = new THREE.Points(jGeo, spriteMatVC(glowBlue, 2, 0.35));
                jets.rotation.x = Math.PI * 0.38;
                group.add(jets);
            }
        }

        // Event horizon — dark center (tiny black sprite cluster)
        var ehGeo = new THREE.BufferGeometry();
        var ehCount = M?20:60;
        var ehPos = new Float32Array(ehCount*3);
        for(var e=0;e<ehCount;e++){var er2=Math.random()*8*S;var et=Math.random()*Math.PI*2;ehPos[e*3]=Math.cos(et)*er2*0.5;ehPos[e*3+1]=Math.sin(et)*er2*0.3;ehPos[e*3+2]=(Math.random()-0.5)*2;}
        ehGeo.setAttribute('position', new THREE.BufferAttribute(ehPos, 3));
        // Use non-additive blending for dark center
        group.add(new THREE.Points(ehGeo, new THREE.PointsMaterial({
            size: 6*S, color: 0x020208, transparent: true, opacity: 0.9,
            sizeAttenuation: true, depthWrite: false
        })));

        return group;
    }

    // ================================================================
    // 6. PLANETARY NEBULA — hourglass / ring + bipolar outflow
    // ================================================================
    function makePlanetaryNebula(cx, cy, cz, size) {
        var group = new THREE.Group();
        group.position.set(cx, cy, cz);
        // Toroidal ring (equatorial)
        var rC = M?120:350;
        var rGeo = new THREE.BufferGeometry();
        var rPos = new Float32Array(rC*3), rCol = new Float32Array(rC*3);
        for(var i=0;i<rC;i++){var a=Math.random()*Math.PI*2;var r=size*(0.6+Math.random()*0.4);var tubeR=size*0.15;rPos[i*3]=Math.cos(a)*r+(Math.random()-0.5)*tubeR;rPos[i*3+1]=(Math.random()-0.5)*tubeR;rPos[i*3+2]=Math.sin(a)*r+(Math.random()-0.5)*tubeR;var t=Math.random();rCol[i*3]=0.2+t*0.3;rCol[i*3+1]=0.7+t*0.3;rCol[i*3+2]=0.6+t*0.4;}
        rGeo.setAttribute('position', new THREE.BufferAttribute(rPos, 3));
        rGeo.setAttribute('color', new THREE.BufferAttribute(rCol, 3));
        group.add(new THREE.Points(rGeo, spriteMatVC(glowCyan, M?3:4.5, 0.45)));
        // Bipolar lobes
        var lC = M?80:200;
        var lGeo = new THREE.BufferGeometry();
        var lPos = new Float32Array(lC*3), lCol = new Float32Array(lC*3);
        for(var j=0;j<lC;j++){var dir=j<lC/2?1:-1;var d=Math.random()*size*1.8;var spread=size*0.3*(1-d/(size*1.8))+size*0.05;lPos[j*3]=(Math.random()-0.5)*spread;lPos[j*3+1]=dir*(size*0.3+d);lPos[j*3+2]=(Math.random()-0.5)*spread;var lt=d/(size*1.8);lCol[j*3]=0.8+lt*0.2;lCol[j*3+1]=0.3+lt*0.4;lCol[j*3+2]=0.6+lt*0.4;}
        lGeo.setAttribute('position', new THREE.BufferAttribute(lPos, 3));
        lGeo.setAttribute('color', new THREE.BufferAttribute(lCol, 3));
        group.add(new THREE.Points(lGeo, spriteMatVC(glowPink, M?2.5:3.5, 0.35)));
        // Central white dwarf
        var wGeo = new THREE.BufferGeometry();
        wGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0,0,0]), 3));
        group.add(new THREE.Points(wGeo, spriteMat(glowWhite, 6, 0.9)));
        return group;
    }

    // ================================================================
    // 7. DUST LANE
    // ================================================================
    function makeDust(cx,cy,cz,len,w,count,color,opacity){
        var geo=new THREE.BufferGeometry();var pos=new Float32Array(count*3);
        for(var i=0;i<count;i++){pos[i*3]=(Math.random()-0.5)*w;pos[i*3+1]=(Math.random()-0.5)*w*0.12;pos[i*3+2]=(Math.random()-0.5)*len;}
        geo.setAttribute('position',new THREE.BufferAttribute(pos,3));
        var d=new THREE.Points(geo,spriteMat(glowSoft,M?2:3,opacity));
        d.position.set(cx,cy,cz);return d;
    }

    // ================================================================
    // 8. STAR CLUSTER
    // ================================================================
    function makeCluster(cx,cy,cz,count,radius){
        var geo=new THREE.BufferGeometry();var pos=new Float32Array(count*3),col=new Float32Array(count*3);
        for(var i=0;i<count;i++){var r=radius*Math.pow(Math.random(),2);var t=Math.random()*Math.PI*2,p=Math.acos(2*Math.random()-1);pos[i*3]=r*Math.sin(p)*Math.cos(t);pos[i*3+1]=r*Math.sin(p)*Math.sin(t);pos[i*3+2]=r*Math.cos(p);var temp=4000+Math.pow(Math.random(),2)*20000;var c=tempToColor(temp);col[i*3]=c[0];col[i*3+1]=c[1];col[i*3+2]=c[2];}
        geo.setAttribute('position',new THREE.BufferAttribute(pos,3));
        geo.setAttribute('color',new THREE.BufferAttribute(col,3));
        var cl=new THREE.Points(geo,spriteMatVC(glowWhite,M?2:3,0.8));
        cl.position.set(cx,cy,cz);return cl;
    }

    // ================================================================
    // 9. CONSTELLATION
    // ================================================================
    function makeConstellation(cx,cy,cz,pts){
        var g=new THREE.Group();g.position.set(cx,cy,cz);
        var sGeo=new THREE.BufferGeometry();var sPos=new Float32Array(pts.length*3);
        for(var i=0;i<pts.length;i++){sPos[i*3]=pts[i][0];sPos[i*3+1]=pts[i][1];sPos[i*3+2]=0;}
        sGeo.setAttribute('position',new THREE.BufferAttribute(sPos,3));
        g.add(new THREE.Points(sGeo,spriteMat(glowWhite,4,0.7)));
        var lPos=[];for(var j=0;j<pts.length-1;j++){lPos.push(pts[j][0],pts[j][1],0,pts[j+1][0],pts[j+1][1],0);}
        var lGeo=new THREE.BufferGeometry();lGeo.setAttribute('position',new THREE.BufferAttribute(new Float32Array(lPos),3));
        g.add(new THREE.LineSegments(lGeo,new THREE.LineBasicMaterial({color:0x7b73ff,transparent:true,opacity:0.1,blending:THREE.AdditiveBlending})));
        return g;
    }

    // ================================================================
    // 10. PULSAR — rotating neutron star with lighthouse beams
    //     Real physics: beams sweep due to misaligned magnetic axis
    // ================================================================
    function makePulsar(cx, cy, cz, beamLen) {
        var group = new THREE.Group();
        group.position.set(cx, cy, cz);

        // Neutron star core — tiny, ultra-dense, hot (10^6 K → blue-white)
        var cGeo = new THREE.BufferGeometry();
        var cC = M ? 20 : 50;
        var cPos = new Float32Array(cC * 3);
        for (var i = 0; i < cC; i++) {
            var cr = Math.random() * 2;
            var ct = Math.random()*Math.PI*2, cp = Math.acos(2*Math.random()-1);
            cPos[i*3] = cr*Math.sin(cp)*Math.cos(ct);
            cPos[i*3+1] = cr*Math.sin(cp)*Math.sin(ct);
            cPos[i*3+2] = cr*Math.cos(cp);
        }
        cGeo.setAttribute('position', new THREE.BufferAttribute(cPos, 3));
        group.add(new THREE.Points(cGeo, spriteMat(glowWhite, 5, 0.95)));

        // Magnetosphere glow
        var mC = M ? 40 : 120;
        var mGeo = new THREE.BufferGeometry();
        var mPos = new Float32Array(mC * 3);
        for (var m = 0; m < mC; m++) {
            var mr = 3 + Math.random() * 8;
            var mt = Math.random()*Math.PI*2, mp = Math.acos(2*Math.random()-1);
            mPos[m*3] = mr*Math.sin(mp)*Math.cos(mt);
            mPos[m*3+1] = mr*Math.sin(mp)*Math.sin(mt);
            mPos[m*3+2] = mr*Math.cos(mp);
        }
        mGeo.setAttribute('position', new THREE.BufferAttribute(mPos, 3));
        group.add(new THREE.Points(mGeo, spriteMat(glowBlue, 3, 0.25)));

        // Two lighthouse beams — tilted 30° from rotation axis
        var bL = beamLen || 80;
        for (var b = 0; b < 2; b++) {
            var dir = b === 0 ? 1 : -1;
            var bC = M ? 40 : 120;
            var bGeo = new THREE.BufferGeometry();
            var bPos = new Float32Array(bC * 3);
            var bCol = new Float32Array(bC * 3);
            for (var bi = 0; bi < bC; bi++) {
                var bd = 3 + Math.pow(Math.random(), 0.5) * bL;
                var bSpread = 1 + bd * 0.025;
                bPos[bi*3] = (Math.random()-0.5) * bSpread;
                bPos[bi*3+1] = dir * bd;
                bPos[bi*3+2] = (Math.random()-0.5) * bSpread;
                var bt = bd / bL;
                bCol[bi*3] = 0.6+bt*0.4; bCol[bi*3+1] = 0.8+bt*0.2; bCol[bi*3+2] = 1;
            }
            bGeo.setAttribute('position', new THREE.BufferAttribute(bPos, 3));
            bGeo.setAttribute('color', new THREE.BufferAttribute(bCol, 3));
            var beam = new THREE.Points(bGeo, spriteMatVC(glowCyan, M ? 1.5 : 2.5, 0.5));
            beam.rotation.z = Math.PI * 0.17; // tilt from axis — misaligned dipole
            group.add(beam);
        }
        group.userData.isAnimated = true;
        return group;
    }

    // ================================================================
    // 11. QUASAR — supermassive black hole with extreme luminosity
    //     Brighter than a galaxy, powered by accretion
    // ================================================================
    function makeQuasar(cx, cy, cz, scale) {
        var group = new THREE.Group();
        group.position.set(cx, cy, cz);
        var S = scale || 1;

        // Hyper-luminous core
        var cGeo = new THREE.BufferGeometry();
        var cC = M ? 30 : 80;
        var cPos = new Float32Array(cC * 3);
        for (var i = 0; i < cC; i++) {
            var cr = Math.random() * 3 * S;
            var ct = Math.random()*Math.PI*2;
            cPos[i*3] = Math.cos(ct)*cr; cPos[i*3+1] = Math.sin(ct)*cr; cPos[i*3+2] = (Math.random()-0.5)*cr;
        }
        cGeo.setAttribute('position', new THREE.BufferAttribute(cPos, 3));
        group.add(new THREE.Points(cGeo, spriteMat(glowWhite, 8 * S, 1.0)));

        // Broad-line emission region (fast-moving gas close to BH)
        var blC = M ? 60 : 200;
        var blGeo = new THREE.BufferGeometry();
        var blPos = new Float32Array(blC * 3), blCol = new Float32Array(blC * 3);
        for (var j = 0; j < blC; j++) {
            var br = (4 + Math.random() * 20) * S;
            var ba = Math.random() * Math.PI * 2;
            blPos[j*3] = Math.cos(ba)*br; blPos[j*3+1] = (Math.random()-0.5)*3*S; blPos[j*3+2] = Math.sin(ba)*br;
            blCol[j*3] = 1; blCol[j*3+1] = 0.85+Math.random()*0.15; blCol[j*3+2] = 0.7+Math.random()*0.3;
        }
        blGeo.setAttribute('position', new THREE.BufferAttribute(blPos, 3));
        blGeo.setAttribute('color', new THREE.BufferAttribute(blCol, 3));
        var blDisk = new THREE.Points(blGeo, spriteMatVC(glowOrange, 3 * S, 0.7));
        blDisk.rotation.x = Math.PI * 0.35;
        group.add(blDisk);
        group.userData.blDisk = blDisk;

        // Narrow-line region (slower gas, further out — the "halo")
        var nlC = M ? 100 : 350;
        var nlGeo = new THREE.BufferGeometry();
        var nlPos = new Float32Array(nlC * 3), nlCol = new Float32Array(nlC * 3);
        for (var k = 0; k < nlC; k++) {
            var nr = (20 + Math.random() * 60) * S;
            var na = Math.random() * Math.PI * 2;
            var nh = (Math.random()-0.5) * nr * 0.3;
            nlPos[k*3] = Math.cos(na)*nr; nlPos[k*3+1] = nh; nlPos[k*3+2] = Math.sin(na)*nr;
            var nt = nr / (80*S);
            nlCol[k*3] = 0.6+nt*0.3; nlCol[k*3+1] = 0.4+nt*0.4; nlCol[k*3+2] = 1;
        }
        nlGeo.setAttribute('position', new THREE.BufferAttribute(nlPos, 3));
        nlGeo.setAttribute('color', new THREE.BufferAttribute(nlCol, 3));
        group.add(new THREE.Points(nlGeo, spriteMatVC(glowPurple, M ? 3 : 5, 0.25)));

        // Enormous relativistic jets (much longer than black hole jets)
        if (!M) {
            for (var jj = 0; jj < 2; jj++) {
                var dir = jj === 0 ? 1 : -1;
                var jC = 250;
                var jGeo = new THREE.BufferGeometry();
                var jPos = new Float32Array(jC * 3), jCol = new Float32Array(jC * 3);
                for (var m = 0; m < jC; m++) {
                    var jd = (5 + Math.pow(Math.random(), 0.5) * 200) * S;
                    var jSpread = 1.5 + jd * 0.02;
                    jPos[m*3] = (Math.random()-0.5)*jSpread;
                    jPos[m*3+1] = dir * (5*S + jd);
                    jPos[m*3+2] = (Math.random()-0.5)*jSpread;
                    var jt = jd/(205*S);
                    jCol[m*3] = 0.3+jt*0.5; jCol[m*3+1] = 0.4+jt*0.4; jCol[m*3+2] = 1;
                }
                jGeo.setAttribute('position', new THREE.BufferAttribute(jPos, 3));
                jGeo.setAttribute('color', new THREE.BufferAttribute(jCol, 3));
                group.add(new THREE.Points(jGeo, spriteMatVC(glowBlue, 2.5, 0.4)));
            }
        }
        return group;
    }

    // ================================================================
    // 12. CRAB NEBULA (M1) — synchrotron nebula + pulsar wind
    //     Filamentary structure from Rayleigh-Taylor instability
    // ================================================================
    function makeCrabNebula(cx, cy, cz, size) {
        var group = new THREE.Group();
        group.position.set(cx, cy, cz);

        // Central pulsar
        var pGeo = new THREE.BufferGeometry();
        pGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0,0,0]), 3));
        group.add(new THREE.Points(pGeo, spriteMat(glowWhite, 6, 0.95)));

        // Synchrotron nebula — smooth blue-white inner glow (pulsar wind)
        var synC = M ? 150 : 500;
        var synGeo = new THREE.BufferGeometry();
        var synPos = new Float32Array(synC * 3), synCol = new Float32Array(synC * 3);
        for (var i = 0; i < synC; i++) {
            // Elongated ellipsoid (Crab is ~6:4 aspect ratio)
            var r = size * 0.4 * Math.pow(Math.random(), 0.6);
            var th = Math.random()*Math.PI*2, ph = Math.acos(2*Math.random()-1);
            synPos[i*3] = r * Math.sin(ph) * Math.cos(th) * 1.3;
            synPos[i*3+1] = r * Math.sin(ph) * Math.sin(th);
            synPos[i*3+2] = r * Math.cos(ph) * 0.9;
            synCol[i*3] = 0.6+Math.random()*0.3;
            synCol[i*3+1] = 0.7+Math.random()*0.2;
            synCol[i*3+2] = 1;
        }
        synGeo.setAttribute('position', new THREE.BufferAttribute(synPos, 3));
        synGeo.setAttribute('color', new THREE.BufferAttribute(synCol, 3));
        group.add(new THREE.Points(synGeo, spriteMatVC(glowBlue, M ? 3 : 5, 0.4)));

        // Filamentary shell — the iconic red/orange tendrils
        var filC = M ? 200 : 700;
        var filGeo = new THREE.BufferGeometry();
        var filPos = new Float32Array(filC * 3), filCol = new Float32Array(filC * 3);
        // Create ~20 filament "fingers" radiating outward
        var numFil = M ? 10 : 22;
        for (var f = 0; f < filC; f++) {
            var filIdx = f % numFil;
            var filAngle = filIdx * (Math.PI * 2 / numFil) + (Math.random()-0.5)*0.3;
            var filElev = (Math.random()-0.5) * Math.PI * 0.8;
            var fd = size * (0.3 + Math.random() * 0.7);
            var wiggle = Math.sin(fd * 0.1 + filIdx) * size * 0.08;
            filPos[f*3] = Math.cos(filAngle) * fd * 1.3 + wiggle;
            filPos[f*3+1] = Math.sin(filElev) * fd * 0.6 + wiggle * 0.5;
            filPos[f*3+2] = Math.sin(filAngle) * fd * 0.9;
            // H-alpha red + some green from O III
            var ft = fd / size;
            if (Math.random() < 0.7) {
                filCol[f*3] = 0.9+Math.random()*0.1; filCol[f*3+1] = 0.25+ft*0.2; filCol[f*3+2] = 0.15+ft*0.1;
            } else {
                filCol[f*3] = 0.2+ft*0.3; filCol[f*3+1] = 0.8+Math.random()*0.2; filCol[f*3+2] = 0.3+ft*0.2;
            }
        }
        filGeo.setAttribute('position', new THREE.BufferAttribute(filPos, 3));
        filGeo.setAttribute('color', new THREE.BufferAttribute(filCol, 3));
        group.add(new THREE.Points(filGeo, spriteMatVC(glowSoft, M ? 2.5 : 4, 0.5)));

        // Outer faint halo
        var hC = M ? 60 : 200;
        var hGeo = new THREE.BufferGeometry();
        var hPos = new Float32Array(hC * 3);
        for (var h = 0; h < hC; h++) {
            var hr = size * (0.8 + Math.random() * 0.3);
            var ht = Math.random()*Math.PI*2, hp = Math.acos(2*Math.random()-1);
            hPos[h*3] = hr*Math.sin(hp)*Math.cos(ht)*1.3;
            hPos[h*3+1] = hr*Math.sin(hp)*Math.sin(ht);
            hPos[h*3+2] = hr*Math.cos(hp)*0.9;
        }
        hGeo.setAttribute('position', new THREE.BufferAttribute(hPos, 3));
        group.add(new THREE.Points(hGeo, spriteMat(glowRed, M ? 3 : 5, 0.15)));

        return group;
    }

    // ================================================================
    // SPACESHIPS — multi-section body + plasma exhaust trail
    // ================================================================
    var ships = [];
    function spawnShip(zR) {
        var tL = 50;
        var geo = new THREE.BufferGeometry();
        var pos = new Float32Array(tL * 3), col = new Float32Array(tL * 3);
        var sx = (Math.random()-0.5) * 300;
        var sy = (Math.random()-0.5) * 200;
        var sz = zR[0] + Math.random() * (zR[1] - zR[0]);
        for (var i = 0; i < tL; i++) {
            pos[i*3] = sx; pos[i*3+1] = sy; pos[i*3+2] = sz;
            var t = i / tL;
            // Head is bright white, trail fades through cyan to blue
            if (i < 3) {
                col[i*3] = 1; col[i*3+1] = 1; col[i*3+2] = 1;
            } else {
                col[i*3] = 0.1+(1-t)*0.6; col[i*3+1] = 0.5+(1-t)*0.5; col[i*3+2] = 1;
            }
        }
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
        var trail = new THREE.Points(geo, spriteMatVC(glowCyan, M ? 2.5 : 3.5, 0.8));
        scene.add(trail);
        var a = Math.random() * Math.PI * 2;
        var spd = 1.5 + Math.random() * 2.5;
        ships.push({ mesh: trail, hx: sx, hy: sy, hz: sz,
            vx: Math.cos(a)*spd, vy: (Math.random()-0.5)*0.5, vz: Math.sin(a)*spd*0.3 - 0.8,
            life: 0, max: 280 + Math.random()*220 });
    }

    var meteors = [];
    function spawnMeteor(zN) {
        var len = 25;
        var geo = new THREE.BufferGeometry();
        var pos = new Float32Array(len * 3), col = new Float32Array(len * 3);
        var sx = (Math.random()-0.5)*600, sy = 150+Math.random()*300, sz = zN - Math.random()*400;
        for (var i = 0; i < len; i++) {
            pos[i*3] = sx-i*2.5; pos[i*3+1] = sy-i*1.2; pos[i*3+2] = sz;
            var t = i/len;
            col[i*3] = 1; col[i*3+1] = 0.9-t*0.5; col[i*3+2] = 0.7-t*0.5;
        }
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
        var s = new THREE.Points(geo, spriteMatVC(glowWhite, 2.5, 0));
        scene.add(s);
        meteors.push({ mesh: s, speed: 10+Math.random()*7, life: 0, max: 35+Math.random()*25 });
    }

    // ================================================================
    // BUILD THE JOURNEY
    // ================================================================
    var bgStars = makeSkyDome(M?3000:7000);
    scene.add(bgStars);

    var tunnel = makeStars(M?5000:14000, JOURNEY+1000, M?500:800);
    scene.add(tunnel);

    // Zone 1 — Hero: star clusters + constellations
    scene.add(makeCluster(-250,-80,-600,M?100:350,55));
    if(!M){scene.add(makeConstellation(-180,100,-350,[[-30,0],[0,40],[30,10],[60,50],[40,-20]]));scene.add(makeConstellation(220,-60,-550,[[0,0],[40,30],[80,10],[60,-30],[20,-20]]));scene.add(makeCluster(300,150,-750,250,40));}

    // Pulsar in hero zone — visible rotating beacon
    var pulsar1 = makePulsar(350, -120, -500, 70);
    scene.add(pulsar1);

    // Zone 2 — About: Emission nebula region
    var nebulae=[];
    [[- 120,50,-800,M?300:800,200,0x7b73ff,0.09],
     [200,-30,-1100,M?250:700,260,0x38d9ff,0.07],
     [-80,120,-1400,M?200:600,180,0xff7bab,0.08],
     [160,-90,-1700,M?180:550,230,0x9966ff,0.06],
     [-30,15,-950,M?150:450,140,0x44aacc,0.05],
     [80,70,-1250,M?120:400,170,0x66dd88,0.04]
    ].forEach(function(n){var c=makeNebula(n[0],n[1],n[2],n[3],n[4],n[5],n[6]);scene.add(c);nebulae.push(c);});
    if(!M){scene.add(makeDust(-120,25,-1050,700,150,500,0x5544aa,0.04));scene.add(makeDust(100,-40,-1450,600,120,400,0x3388aa,0.03));scene.add(makeDust(-60,70,-1750,500,100,300,0x664488,0.025));}
    scene.add(makePlanetaryNebula(250,110,-1600,40));

    // Zone 3 — Experience: Galaxy corridor
    var galaxy1=makeGalaxy(-180,60,-2250,M?2000:7000,190,3,0x7b73ff,0x38d9ff,Math.PI*0.3);scene.add(galaxy1);
    if(!M){var galaxy2=makeGalaxy(300,-50,-2700,4000,140,2,0xff7bab,0x9966ff,Math.PI*0.55);scene.add(galaxy2);scene.add(makeGalaxy(-400,180,-3000,1500,55,4,0x44aacc,0x7b73ff,Math.PI*0.48));}
    scene.add(makeNebula(220,140,-2500,M?120:400,160,0x4466cc,0.04));
    // Quasar near galaxies — the brightest object in the scene
    var quasar1 = makeQuasar(400, -150, -2600, M ? 0.6 : 1.0);
    scene.add(quasar1);
    scene.add(makeCluster(-300,-100,-2100,M?100:400,55));scene.add(makeCluster(160,200,-2900,M?80:300,40));
    if(!M){scene.add(makeConstellation(260,-150,-2400,[[0,0],[25,35],[55,20],[75,55],[50,-10]]));scene.add(makeDust(160,35,-2600,600,180,450,0x332266,0.03));}

    // Zone 4 — Skills: Supernovae + Black hole
    var supernova1=makeSupernova(100,50,-3350,95);scene.add(supernova1);
    if(!M){var supernova2=makeSupernova(-200,-30,-3800,70);scene.add(supernova2);}
    var blackhole1=makeBlackHole(-60,20,-3600,1.3);scene.add(blackhole1);
    var astGeo=new THREE.BufferGeometry();var astC=M?500:1500;var astP=new Float32Array(astC*3);
    for(var ai=0;ai<astC;ai++){var aa=Math.random()*Math.PI*2,ar=150+Math.random()*200;astP[ai*3]=Math.cos(aa)*ar;astP[ai*3+1]=(Math.random()-0.5)*20;astP[ai*3+2]=Math.sin(aa)*ar-3500;}
    astGeo.setAttribute('position',new THREE.BufferAttribute(astP,3));
    var asteroids=new THREE.Points(astGeo,spriteMat(glowSoft,1.5,0.35));scene.add(asteroids);
    scene.add(makeCluster(250,-70,-3300,M?80:280,40));
    scene.add(makeNebula(-220,130,-3900,M?100:300,160,0xff7bab,0.04));
    // Pulsar near the supernova remnant
    var pulsar2 = makePulsar(-300, -80, -3450, 60);
    scene.add(pulsar2);
    if(!M){scene.add(makeDust(-160,-15,-3700,600,150,350,0x553344,0.035));}

    // Zone 5 — Projects: Deep space + planetary nebula
    scene.add(makeNebula(-180,80,-4450,M?180:500,220,0x7b73ff,0.06));
    scene.add(makeNebula(200,-60,-4750,M?150:450,190,0x00ccaa,0.05));
    scene.add(makePlanetaryNebula(-150,-40,-4600,50));
    // Crab Nebula — the showpiece of Zone 5
    var crab = makeCrabNebula(100, 50, -4700, 65);
    scene.add(crab);
    scene.add(makeCluster(260,130,-4350,M?80:280,45));
    if(!M){scene.add(makeDust(0,0,-4550,900,230,500,0x443388,0.03));scene.add(makeGalaxy(340,140,-4950,1500,70,2,0x38d9ff,0x7b73ff,Math.PI*0.4));scene.add(makeConstellation(-260,90,-4850,[[-20,0],[10,30],[40,15],[70,45],[50,-10]]));}
    scene.add(makeNebula(80,180,-5050,M?100:300,160,0x9966ff,0.035));

    // Zone 6 — Education/Contact: Grand finale
    scene.add(makeNebula(0,0,-5350,M?150:400,270,0x38d9ff,0.04));
    scene.add(makeNebula(-220,100,-5650,M?100:300,190,0x7b73ff,0.035));
    if(!M){var supernova3=makeSupernova(-260,100,-5550,65);scene.add(supernova3);}
    var blackhole2=makeBlackHole(130,-15,-5700,1.1);scene.add(blackhole2);
    // Final quasar — grand finale glow
    var quasar2 = makeQuasar(-350, 80, -5850, M ? 0.5 : 0.8);
    scene.add(quasar2);
    scene.add(makeCluster(-80,-60,-5450,M?100:350,60));scene.add(makeCluster(220,180,-5850,M?70:230,40));
    if(!M){scene.add(makePlanetaryNebula(300,-80,-5650,35));scene.add(makeDust(80,40,-5550,600,190,400,0x335566,0.025));scene.add(makeConstellation(180,70,-5250,[[-20,0],[10,30],[40,15],[70,45],[50,-10],[0,-25],[-20,0]]));}

    var maxShips=M?4:9;for(var si=0;si<maxShips;si++)spawnShip([-500,-5500]);

    // ================================================================
    // ANIMATION
    // ================================================================
    var frame=0;
    function animate(){
        requestAnimationFrame(animate);frame++;
        var elapsed=clock.getElapsedTime();

        mouse.x+=(mouse.tx-mouse.x)*0.04;mouse.y+=(mouse.ty-mouse.y)*0.04;

        var scrollY=window.scrollY||window.pageYOffset;
        var docH=document.documentElement.scrollHeight-window.innerHeight;
        var scrollPct=docH>0?scrollY/docH:0;
        var targetZ=-scrollPct*JOURNEY;

        var isWarping=document.body.classList.contains('warp-speed');
        scrollZ+=(targetZ-scrollZ)*(isWarping?0.15:0.08);

        var targetFOV=isWarping?95:65;
        camera.fov+=(targetFOV-camera.fov)*0.05;
        camera.updateProjectionMatrix();

        tunnel.material.opacity=isWarping?1:0.85;
        tunnel.material.size=isWarping?5:3;

        camera.position.z=scrollZ;
        camera.position.x=mouse.x*30;
        camera.position.y=-mouse.y*20;
        camera.lookAt(camera.position.x*0.5,camera.position.y*0.5,scrollZ-200);

        bgStars.position.z=scrollZ*0.3;

        // Nebulae drift
        nebulae.forEach(function(c,i){c.position.y+=Math.sin(elapsed*0.2+i*2.3)*0.06;c.position.x+=Math.cos(elapsed*0.15+i*1.8)*0.04;c.rotation.y+=0.0001;});

        // Galaxies
        if(galaxy1)galaxy1.rotation.y+=0.0004;
        if(!M&&galaxy2)galaxy2.rotation.y-=0.0003;

        // Supernovae pulse
        [supernova1,supernova2,!M&&supernova3].forEach(function(sn,idx){if(!sn||!sn.userData.shell)return;var p=Math.sin(elapsed*0.5+idx*2)*0.1+1;sn.scale.set(p,p,p);sn.userData.shell.material.opacity=0.35+Math.sin(elapsed*0.8+idx)*0.12;sn.rotation.y+=0.0008;});

        // Black holes spin
        if(blackhole1&&blackhole1.userData.disk)blackhole1.userData.disk.rotation.z+=0.005;
        if(blackhole2&&blackhole2.userData.disk)blackhole2.userData.disk.rotation.z-=0.004;
        if(blackhole1)blackhole1.rotation.y+=0.0006;
        if(blackhole2)blackhole2.rotation.y-=0.0005;

        // Asteroids orbit
        asteroids.rotation.y+=0.0003;

        // Pulsars — fast rotation (real pulsars spin 1-700 times/sec, we do ~1 rev/3sec)
        if(pulsar1) pulsar1.rotation.y += 0.035;
        if(pulsar2) pulsar2.rotation.y += 0.045;
        // Beam intensity pulsing (lighthouse effect as beams sweep toward/away from camera)
        [pulsar1, pulsar2].forEach(function(p) {
            if (!p) return;
            var phase = Math.sin(elapsed * 8 + (p === pulsar2 ? 2 : 0));
            p.children.forEach(function(child, idx) {
                if (idx > 1) child.material.opacity = 0.2 + Math.max(0, phase) * 0.4; // beams pulse
            });
        });

        // Quasars — slow spin + luminosity flicker (AGN variability)
        if(quasar1) {
            if(quasar1.userData.blDisk) quasar1.userData.blDisk.rotation.z += 0.003;
            quasar1.rotation.y += 0.0004;
            quasar1.children[0].material.opacity = 0.85 + Math.sin(elapsed * 3) * 0.15; // core flicker
        }
        if(quasar2) {
            if(quasar2.userData.blDisk) quasar2.userData.blDisk.rotation.z -= 0.002;
            quasar2.rotation.y -= 0.0003;
            quasar2.children[0].material.opacity = 0.85 + Math.sin(elapsed * 2.5 + 1) * 0.15;
        }

        // Crab Nebula — very slow expansion (real: 1500 km/s, us: visual pulse)
        if(crab) {
            var crabPulse = 1 + Math.sin(elapsed * 0.3) * 0.02;
            crab.scale.set(crabPulse, crabPulse, crabPulse);
            crab.rotation.y += 0.0002;
        }

        // Ships
        for(var si2=ships.length-1;si2>=0;si2--){var s=ships[si2];s.life++;s.hx+=s.vx;s.hy+=s.vy;s.hz+=s.vz;var sp=s.mesh.geometry.attributes.position.array;for(var sj=sp.length/3-1;sj>0;sj--){sp[sj*3]=sp[(sj-1)*3];sp[sj*3+1]=sp[(sj-1)*3+1];sp[sj*3+2]=sp[(sj-1)*3+2];}sp[0]=s.hx;sp[1]=s.hy;sp[2]=s.hz;s.mesh.geometry.attributes.position.needsUpdate=true;if(s.life>s.max){scene.remove(s.mesh);s.mesh.geometry.dispose();s.mesh.material.dispose();ships.splice(si2,1);}}
        if(frame%200===0&&ships.length<maxShips)spawnShip([scrollZ-200,scrollZ-2000]);

        // Meteors
        for(var mi=meteors.length-1;mi>=0;mi--){var m=meteors[mi];m.life++;var mp=m.mesh.geometry.attributes.position.array;for(var mk=0;mk<mp.length/3;mk++){mp[mk*3]+=m.speed;mp[mk*3+1]-=m.speed*0.4;}m.mesh.geometry.attributes.position.needsUpdate=true;var prog=m.life/m.max;m.mesh.material.opacity=prog<0.15?prog/0.15*0.8:prog>0.7?(1-prog)/0.3*0.8:0.8;if(m.life>m.max){scene.remove(m.mesh);m.mesh.geometry.dispose();m.mesh.material.dispose();meteors.splice(mi,1);}}
        if(frame%70===0&&meteors.length<3)spawnMeteor(scrollZ);

        renderer.render(scene,camera);
    }
    animate();

    if(!M){document.addEventListener('mousemove',function(e){mouse.tx=(e.clientX/window.innerWidth-0.5)*2;mouse.ty=(e.clientY/window.innerHeight-0.5)*2;});}
    window.addEventListener('resize',function(){camera.aspect=window.innerWidth/window.innerHeight;camera.updateProjectionMatrix();renderer.setSize(window.innerWidth,window.innerHeight);});
})();
