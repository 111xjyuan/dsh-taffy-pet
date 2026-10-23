import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import {
  VRMLoaderPlugin,
  VRMUtils,
  VRMExpressionPresetName,
  VRMHumanBoneName,
} from '@pixiv/three-vrm'

window.TaffyVRM = { THREE, GLTFLoader, VRMLoaderPlugin, VRMUtils, VRMExpressionPresetName, VRMHumanBoneName }
