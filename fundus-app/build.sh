#!/bin/sh
grep -v ^import /storage/emulated/0/projects/oct/fundus-app/js/img.js | sed "s/export function/function/; s/export const/const/" > /storage/emulated/0/projects/oct/fundus-app/fundus/worker-lib.js
grep -v ^import /storage/emulated/0/projects/oct/fundus-app/js/preprocess.js | sed "s/export function/function/; s/export const/const/" >> /storage/emulated/0/projects/oct/fundus-app/fundus/worker-lib.js
grep -v ^import /storage/emulated/0/projects/oct/fundus-app/js/analyze.js | sed "s/export function/function/; s/export const/const/" >> /storage/emulated/0/projects/oct/fundus-app/fundus/worker-lib.js
node --check /storage/emulated/0/projects/oct/fundus-app/fundus/worker-lib.js && echo bundle-ok
