async function run() {
  const res = await fetch('http://localhost:3000/api/context/preload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      athleteProfile: { id: "test", targetEvents: ["100m"] },
      activeThreadId: "test-thread"
    })
  });
  console.log(await res.json());
}
run();
