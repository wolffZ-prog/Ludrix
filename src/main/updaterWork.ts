import { parentPort, workerData } from 'node:worker_threads';
import { Apply, Restore } from './updater';

const d = workerData as { pkg: string; root: string; restore: boolean; waitPid: number };
const post = (m: any) => parentPort?.postMessage(m);
const a = d.restore ? new Restore(d.pkg, d.root, (s) => post({ log: s }), (f, t) => post({ progress: f, text: t })) : new Apply(d.pkg, d.root, (s) => post({ log: s }), (f, t) => post({ progress: f, text: t }));
try {
    a.read();
    a.run(d.waitPid);
    post({ done: true, ok: true, error: '', manifest: a.manifest });
}
catch (e: any) {
    let err = String(e?.message || e);
    try {
        a.rollback();
    }
    catch (e2: any) {
        post({ log: `rollback falhou: ${e2?.message || e2}` });
    }
    post({ done: true, ok: false, error: err, manifest: a.manifest });
}
