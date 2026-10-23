  /* ------------------------------------------------------- 3D 形态（VRM） */
  var vr = {
    on: false, loading: false, canvas: null, renderer: null, scene: null, camera: null,
    vrm: null, clock: 0, raf: 0, last: 0, files: [], rest: null, lookTarget: null,
    blinkAt: 0, blinkUntil: 0, exprUntil: 0, exprName: '', scriptPromise: null,
    pointer: { x: 0, y: 0 }, bbox: null, fit: null, hopAt: 0, T: null
  }
  var _v3 = { euler: null, quat: null }

  function loadVrmRuntime(cb) {
    if (window.TaffyVRM) return cb(null)
    if (vr.scriptPromise) {
      vr.scriptPromise.then(function () { cb(null) }, cb)
      return
    }
    vr.scriptPromise = new Promise(function (resolve, reject) {
      var sc = document.createElement('script')
      sc.src = API.vrmRuntime
      sc.onload = function () { resolve() }
      sc.onerror = function () { reject(new Error('vrm runtime load failed')) }
      document.head.appendChild(sc)
    })
    vr.scriptPromise.then(function () { cb(null) }, cb)
  }

  function loadVrmList() {
    return fetch(API.vrmList, { credentials: 'same-origin' })
      .then(function (r) { return r.json() })
      .then(function (j) { vr.files = (j && j.files) || []; return vr.files })
      .catch(function () { vr.files = []; return [] })
  }

  function currentVrmFile() {
    if (vr.files.indexOf(state.vrmFile) >= 0) return state.vrmFile
    return vr.files[0] || ''
  }

  function startVrm() {
    if (vr.on || vr.loading) return
    if (!stage) return
    vr.loading = true
    if (!vr.files.length) {
      loadVrmList().then(function () {
        vr.loading = false
        if (!vr.files.length) { state.mode = '2d'; saveState(); renderFigure(); return }
        startVrm()
      })
      return
    }
    loadVrmRuntime(function (err) {
      if (err) {
        console.warn('[taffy] 3D 运行时加载失败', err)
        vr.loading = false
        state.mode = '2d'
        saveState()
        renderFigure()
        return
      }
      buildVrmScene()
    })
  }

  function buildVrmScene() {
    try {
      var T = window.TaffyVRM
      var THREE = T.THREE
      vr.T = T
      _v3.euler = new THREE.Euler()
      _v3.quat = new THREE.Quaternion()
      var canvas = el('canvas', 'tp-vrm')
      var sw = stage.clientWidth || 180
      var sh = stage.clientHeight || 300
      canvas.width = sw
      canvas.height = sh
      layerBox.innerHTML = ''
      layerBox.appendChild(canvas)
      vr.canvas = canvas

      var renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: true })
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
      renderer.setSize(sw, sh, false)
      if (renderer.outputColorSpace !== undefined) renderer.outputColorSpace = THREE.SRGBColorSpace
      vr.renderer = renderer

      var scene = new THREE.Scene()
      vr.scene = scene
      scene.add(new THREE.HemisphereLight(0xffffff, 0xc9b9c9, 2.4))
      var d1 = new THREE.DirectionalLight(0xffffff, 1.5)
      d1.position.set(1.2, 2.4, 2.0)
      scene.add(d1)
      var d2 = new THREE.DirectionalLight(0xffd9ea, 0.6)
      d2.position.set(-1.6, 1.2, 1.2)
      scene.add(d2)

      var camera = new THREE.PerspectiveCamera(30, sw / sh, 0.05, 60)
      vr.camera = camera

      var loader = new T.GLTFLoader()
      loader.register(function (parser) { return new T.VRMLoaderPlugin(parser) })
      var url = API.art + encodeURIComponent('vrm/' + currentVrmFile())
      loader.load(url, function (gltf) {
        try {
          var vrm = gltf.userData.vrm
          if (!vrm) throw new Error('not a vrm')
          T.VRMUtils.removeUnnecessaryVertices(gltf.scene)
          T.VRMUtils.removeUnnecessaryJoints(gltf.scene)
          var isV0 = !vrm.meta || vrm.meta.metaVersion === '0'
          vrm.scene.rotation.y = isV0 ? Math.PI : 0
          scene.add(vrm.scene)
          vr.vrm = vrm
          captureRestPose(T)
          vr.lookTarget = new THREE.Object3D()
          vr.lookTarget.position.set(0, 1.35, 2)
          scene.add(vr.lookTarget)
          if (vrm.lookAt) vrm.lookAt.target = vr.lookTarget
          var box = new THREE.Box3().setFromObject(vrm.scene)
          vr.bbox = { size: box.getSize(new THREE.Vector3()), center: box.getCenter(new THREE.Vector3()) }
          vr.on = true
          vr.loading = false
          root.classList.add('tp-mode-3d')
          resizeVrm()
          vr.last = 0
          vr.raf = requestAnimationFrame(vrmLoop)
        } catch (e) {
          console.warn('[taffy] 3D 模型初始化失败', e)
          stopVrm()
        }
      }, undefined, function (e) {
        console.warn('[taffy] 3D 模型加载失败', e)
        stopVrm()
      })
    } catch (e) {
      console.warn('[taffy] 3D 初始化失败', e)
      stopVrm()
    }
  }

  function captureRestPose(T) {
    var H = T.VRMHumanBoneName
    var names = [H.HIPS, H.SPINE, H.CHEST, H.NECK, H.HEAD,
      H.LEFT_UPPER_ARM, H.RIGHT_UPPER_ARM, H.LEFT_LOWER_ARM, H.RIGHT_LOWER_ARM]
    var rest = {}
    for (var i = 0; i < names.length; i++) {
      var node = vr.vrm.humanoid.getNormalizedBoneNode(names[i])
      if (node) rest[names[i]] = node.quaternion.clone()
    }
    vr.rest = rest
  }

  function setBone(name, ex, ey, ez) {
    if (!vr.vrm || !vr.rest) return
    var node = vr.vrm.humanoid.getNormalizedBoneNode(name)
    if (!node) return
    _v3.euler.set(ex || 0, ey || 0, ez || 0)
    _v3.quat.setFromEuler(_v3.euler)
    var base = vr.rest[name]
    if (base) node.quaternion.copy(base).multiply(_v3.quat)
    else node.quaternion.copy(_v3.quat)
  }

  function setExpr(name, v) {
    try {
      var em = vr.vrm && vr.vrm.expressionManager
      if (em && em.getExpression(name)) em.setValue(name, v)
    } catch (e) {}
  }

  function vrReact(kind) {
    if (!vr.on || !vr.vrm) return
    var now = performance.now()
    if (kind === 'happy') { vr.exprName = 'happy'; vr.exprUntil = now + 1100 }
    else if (kind === 'surprised') { vr.exprName = 'surprised'; vr.exprUntil = now + 700 }
    else if (kind === 'sad') { vr.exprName = 'sad'; vr.exprUntil = now + 1400 }
    vr.hopAt = now
  }

  function resizeVrm() {
    if (!vr.on || !vr.renderer || !vr.canvas) return
    var sw = stage.clientWidth || 180
    var sh = stage.clientHeight || 300
    vr.renderer.setSize(sw, sh, false)
    vr.camera.aspect = sw / sh
    vr.camera.updateProjectionMatrix()
    if (vr.bbox) {
      var size = vr.bbox.size
      var center = vr.bbox.center
      var fov = vr.camera.fov * Math.PI / 180
      var distH = (size.y / 2) / Math.tan(fov / 2) * 1.02
      var distW = (size.x / 2) / Math.tan(fov / 2) / Math.max(0.2, vr.camera.aspect) * 1.02
      var dist = Math.max(distH, distW)
      vr.camera.position.set(center.x, center.y, dist)
      vr.camera.lookAt(center.x, center.y, center.z)
      vr.camera.updateMatrixWorld()
      vr.fit = { center: center, dist: dist }
    }
  }

  function vrmLoop(now) {
    if (!vr.on) return
    vr.raf = requestAnimationFrame(vrmLoop)
    var dt = vr.last ? Math.min(0.06, (now - vr.last) / 1000) : 0.016
    vr.last = now
    if (!vr.vrm) return
    vr.clock += dt
    var t = vr.clock
    var H = vr.T.VRMHumanBoneName
    var idle = REDUCED ? 0.35 : 1

    setBone(H.SPINE, Math.sin(t * 1.05) * 0.018 * idle, 0, 0)
    setBone(H.CHEST, Math.sin(t * 1.05 + 0.5) * 0.014 * idle, 0, 0)
    setBone(H.HIPS, 0, Math.sin(t * 0.42) * 0.085 * idle, Math.sin(t * 0.42) * 0.02 * idle)

    var lookX = vr.pointer.x
    var lookY = vr.pointer.y
    setBone(H.NECK,
      Math.sin(t * 0.55) * 0.03 * idle + lookY * 0.05,
      Math.sin(t * 0.33) * 0.06 * idle + lookX * 0.10, 0)
    setBone(H.HEAD,
      Math.sin(t * 0.47 + 0.8) * 0.02 * idle + lookY * 0.04,
      Math.sin(t * 0.29) * 0.05 * idle + lookX * 0.08,
      Math.sin(t * 0.31) * 0.03 * idle)

    setBone(H.LEFT_UPPER_ARM, 0, 0, -1.22 + Math.sin(t * 0.9) * 0.03 * idle)
    setBone(H.RIGHT_UPPER_ARM, 0, 0, 1.22 - Math.sin(t * 0.9 + 0.6) * 0.03 * idle)
    setBone(H.LEFT_LOWER_ARM, 0, 0.12, -0.12)
    setBone(H.RIGHT_LOWER_ARM, 0, -0.12, 0.12)

    if (now > vr.blinkAt) {
      vr.blinkUntil = now + 110
      vr.blinkAt = now + 2600 + Math.random() * 4200
    }
    setExpr('blink', now < vr.blinkUntil ? 1 : 0)
    if (vr.exprName && now > vr.exprUntil) vr.exprName = ''
    if (vr.exprName) setExpr(vr.exprName, 1)

    if (vr.lookTarget && vr.fit && vr.bbox) {
      var c = vr.fit.center
      vr.lookTarget.position.set(c.x + lookX * 0.45, c.y + 0.55 + lookY * 0.25, c.z + 1.6)
    }

    if (vr.hopAt) {
      var k = (now - vr.hopAt) / 420
      if (k < 1) vr.vrm.scene.position.y = Math.sin(k * Math.PI) * 0.06
      else { vr.vrm.scene.position.y = 0; vr.hopAt = 0 }
    }

    vr.vrm.update(dt)
    vr.renderer.render(vr.scene, vr.camera)
  }

  function stopVrm() {
    vr.loading = false
    if (vr.raf) cancelAnimationFrame(vr.raf)
    vr.raf = 0
    vr.on = false
    vr.last = 0
    if (root) root.classList.remove('tp-mode-3d')
    try { if (vr.renderer) vr.renderer.dispose() } catch (e) {}
    if (vr.scene) {
      vr.scene.traverse(function (o) {
        if (o.geometry) o.geometry.dispose()
        if (o.material) {
          var m = o.material
          if (m.map) m.map.dispose()
          m.dispose()
        }
      })
    }
    vr.renderer = null
    vr.scene = null
    vr.camera = null
    vr.vrm = null
    vr.canvas = null
    vr.rest = null
    vr.bbox = null
    vr.fit = null
    if (layerBox) layerBox.innerHTML = ''
  }

