const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

// Replace contextPrompt with an array of parts if there is an image
code = code.replace(
  /const contextPrompt = `ATHLETE FIREBASE PROFILE:([\s\S]*?)ATHLETE PROMPT \/ CONVERSATION:\n\$\{userQuery\}`;/,
  `const contextPromptStr = \`ATHLETE FIREBASE PROFILE:$1ATHLETE PROMPT / CONVERSATION:\n\${userQuery}\`;

    const contents: any[] = [{ text: contextPromptStr }];

    // Handle files in messages (like radiographs or exams)
    let hasMedicalExam = false;
    if (Array.isArray(messages)) {
      for (const m of messages) {
        if (m.fileUrl) {
          try {
            console.log("Fetching attached file from:", m.fileUrl);
            const fileRes = await fetch(m.fileUrl);
            const arrayBuffer = await fileRes.arrayBuffer();
            const base64 = Buffer.from(arrayBuffer).toString('base64');
            contents.push({
              inlineData: {
                data: base64,
                mimeType: m.fileType || 'application/pdf'
              }
            });
            hasMedicalExam = true;
          } catch (e) {
            console.error("Failed to load attached file:", e);
          }
        }
      }
    }

    if (hasMedicalExam) {
      contents.push({
        text: "IMPORTANT: The user has attached a medical exam or radiograph. You MUST analyze it using established sports-medicine/radiology framing cross-referenced against the literature pipeline. YOU MUST also include a clear, prominent disclaimer that this is NOT a diagnostic substitute for a licensed physician/radiologist, and the athlete must have this reviewed in person before modifying training."
      });
    }`
);

// Then update callGeminiWithResilience call to pass contents array instead of contextPrompt
code = code.replace(
  /contents: contextPrompt,/g,
  `contents: contents,`
);

fs.writeFileSync('server.ts', code);
