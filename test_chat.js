async function testChat() {
  console.log("Sending POST /api/chat...");
  const start = Date.now();
  const res = await fetch("http://localhost:3000/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [
        { role: "user", content: "Hola ARIA, estoy en fase de preparación especial SPP y tengo mi próximo torneo regional el 15 de noviembre. ¿Qué debo priorizar hoy?" }
      ],
      athleteProfile: {
        id: "athlete_test_unaffiliated",
        displayName: "Carlos Velocista",
        targetEvents: ["400m"],
        clubId: null,
        role: "ATHLETE"
      }
    })
  });

  console.log(`HTTP ${res.status} received in ${Date.now() - start}ms`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let receivedChunks = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      console.log(`Stream finished (done=true) in ${Date.now() - start}ms, total chunks: ${receivedChunks}`);
      break;
    }
    const chunkText = decoder.decode(value);
    receivedChunks++;
    console.log(`[Chunk ${receivedChunks} @ +${Date.now() - start}ms]:`, chunkText.trim().slice(0, 100));
  }
}

testChat().catch(console.error);
