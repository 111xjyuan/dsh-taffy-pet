import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MMDLoader } from 'three/examples/jsm/loaders/MMDLoader.js'
import {
  VRMLoaderPlugin,
  VRMUtils,
  VRMExpressionPresetName,
  VRMHumanBoneName,
} from '@pixiv/three-vrm'

window.TaffyVRM = { THREE, GLTFLoader, MMDLoader, VRMLoaderPlugin, VRMUtils, VRMExpressionPresetName, VRMHumanBoneName }
