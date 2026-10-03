/** Run from the dev site's console; the benchmark never changes provider keys. */
export async function runBrowserBenchmarks(onProgress?: (phase: string) => void): Promise<unknown> {
  const moduleUrl = new URL("./browser-engine.ts", import.meta.url).href;
  const source = `(async()=>{try {postMessage({progress:'loading'}); const {benchmarkBrowserEngine}=await import(${JSON.stringify(moduleUrl)}); postMessage({progress:'running'});postMessage({value:await benchmarkBrowserEngine()});} catch(error){postMessage({error:String(error),stack:error.stack})}})()`;
  const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
  const worker = new Worker(url, { type: "module" });
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error("Benchmark timed out after 90 seconds")), 90000);
      worker.onmessage = (event) => {
        if (event.data.progress) {
          onProgress?.(event.data.progress);
          return;
        }
        if (event.data.error) reject(new Error(event.data.error + "\n" + event.data.stack));
        else resolve(event.data.value);
      };
      worker.onerror = (event) =>
        reject(new Error(event.message || "Benchmark worker failed to load"));
    });
  } finally {
    clearTimeout(timer!);
    worker.terminate();
    URL.revokeObjectURL(url);
  }
}
