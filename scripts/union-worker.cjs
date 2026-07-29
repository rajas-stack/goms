// Runs robustUnion() for exactly one dissolve call inside a worker thread, so
// the caller can bound it with a timeout (see robustUnionWithTimeout in
// robust-union.cjs). Some source polygons trigger pathological worst-case
// behaviour in polygon-clipping's sweep-line algorithm (observed: Madhya
// Pradesh's Guna/MAKSOODANGARH taluka — only 181 parts, smaller than dozens of
// others that resolved in well under a second, but this one never returned)
// that no amount of chunking avoids, because the bad geometry is small enough
// to land inside a single leaf-level union call. A worker can be killed from
// outside; the synchronous main thread cannot interrupt itself mid-computation.
const { parentPort, workerData } = require('worker_threads')
const { robustUnion } = require('./robust-union.cjs')

parentPort.postMessage(robustUnion(workerData.parts))
