const { Groq } = require('groq-sdk');
const dotenv = require('dotenv');
dotenv.config();

const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY,
});

const translateSegments = async (segments, target) => {
    const langMap = { 'en': 'English', 'fr': 'French', 'es': 'Spanish', 'ar': 'Modern Standard Arabic' };
    const targetLangName = langMap[target] || 'English';

    console.log(`Translating to ${targetLangName}... (${segments.length} segments)`);

    const cleanInput = segments.map(s => ({
        start: s.start,
        end: s.end,
        text: s.normalized_text || s.text
    }));

    const systemPrompt = `You are a specialist JSON translator.
    Task: Translate the "text" field of each provided segment into ${targetLangName}.
    Context: The input text is a mix of Modern Standard Arabic (MSA), French, and English (Tunisian Code-Switching).
    Rule 1: Translate the ENTIRE meaning of the sentence into natural ${targetLangName}.
    Rule 2: Do NOT translate word-by-word; focus on the combined contextual meaning.
    Rule 3: Return ONLY a valid JSON object with the key "segments".
    Rule 4: Do NOT change "start" or "end" values.
    Rule 5: Output raw JSON only.`;

    try {
        const completion = await groq.chat.completions.create({
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: JSON.stringify({ segments: cleanInput }) }
            ],
            model: "llama-3.3-70b-versatile",
            temperature: 0,
            response_format: { type: "json_object" },
        });

        const content = completion.choices[0]?.message?.content;
        const parsed = JSON.parse(content);
        const translated = parsed.segments || (Array.isArray(parsed) ? parsed : null);

        if (Array.isArray(translated) && translated.length === segments.length) {
            return segments.map((s, i) => ({
                ...s,
                text: translated[i].text || s.text
            }));
        }
        console.warn("Translation length mismatch or failure, returning original segments.");
        return segments;
    } catch (e) {
        console.error("Translation logic failed:", e);
        return segments;
    }
};

const { spawn } = require('child_process');
const path = require('path');

// --- Derja Processor Integration ---
let derjaProcess = null;

const initDerjaProcessor = () => {
    if (derjaProcess) return;
    console.log("Starting Derja Processor...");
    derjaProcess = spawn('python', [path.join(__dirname, 'derja_processor.py')]);

    derjaProcess.stderr.on('data', (data) => {
        console.error(`[Derja Py Log]: ${data.toString()}`);
    });

    derjaProcess.on('close', (code) => {
        console.log(`Derja Processor exited with code ${code}`);
        derjaProcess = null;
    });
};

const queryDerja = (command, text) => {
    return new Promise((resolve) => {
        if (!derjaProcess) initDerjaProcessor();

        const onData = (data) => {
            try {
                const response = JSON.parse(data.toString());
                derjaProcess.stdout.removeListener('data', onData);
                resolve(response);
            } catch (e) {
                // Not JSON or partial data, keep waiting
            }
        };

        derjaProcess.stdout.on('data', onData);
        derjaProcess.stdin.write(JSON.stringify({ command, text }) + '\n');
    });
};

initDerjaProcessor();

const normalizeSegments = async (segments) => {
    console.log(`Normalizing Mixed Tunisian Speech... (${segments.length} segments)`);

    // Fetch hints and examples (still useful for the Arabic parts)
    const enhancedSegments = await Promise.all(segments.map(async (s) => {
        // Only query derja for parts that look like Arabic script or the whole thing if it's mostly Arabic
        const correction = await queryDerja('correct', s.text);
        const examples = await queryDerja('examples', s.text);
        return {
            ...s,
            hint: correction?.result?.corrected || null,
            examples: examples?.result || []
        };
    }));

    const systemPrompt = `You are an expert linguist specializing in translating Tunisian Arabic (Derja) into pure Modern Standard Arabic (MSA).
    Task: Translate the provided Tunisian Arabic segments into high-quality, natural Modern Standard Arabic.
    
    Rules:
    1. Convert ALL Tunisian Arabic expressions into their formal MSA equivalents.
    2. TRANSLATE any French or English words (code-switching) into Modern Standard Arabic where appropriate to maintain a formal, consistent tone.
    3. Ensure the result is grammatically correct and sounds natural in a formal context.
    4. Maintain the original meaning and emotional tone of the speaker.
    5. Return ONLY a valid JSON object with the key "segments".
    
    Examples:
    - "اليوم نعمل un meeting important" -> "اليوم نقوم باجتماع هام"
    - "تجم تبعثلي l'email svp؟" -> "هل يمكنك إرسال البريد الإلكتروني من فضلك؟"
    - "C'est bon، كملت الخدمة" -> "حسناً، لقد أكملت العمل"
    `;

    try {
        const completion = await groq.chat.completions.create({
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: JSON.stringify({ segments: enhancedSegments.map(s => ({ start: s.start, end: s.end, text: s.text, hint: s.hint })) }) }
            ],
            model: "llama-3.3-70b-versatile",
            temperature: 0,
            response_format: { type: "json_object" },
        });

        const content = completion.choices[0]?.message?.content;
        const parsed = JSON.parse(content);
        const normalized = parsed.segments || (Array.isArray(parsed) ? parsed : null);

        if (Array.isArray(normalized) && normalized.length === segments.length) {
            return segments.map((s, i) => ({
                ...s,
                normalized_text: normalized[i].normalized_text || s.text
            }));
        }
        console.warn("Normalization returned inconsistent segments, falling back to original.");
        return segments.map(s => ({ ...s, normalized_text: s.text }));
    } catch (e) {
        console.error("Normalization logic failed:", e);
        return segments.map(s => ({ ...s, normalized_text: s.text }));
    }
};

const correctSegments = async (segments) => {
    console.log(`Correcting Transcription Errors... (${segments.length} segments)`);

    // 1. Get Hints from Derja
    const enhancedSegments = await Promise.all(segments.map(async (s) => {
        // Only query for Arabic/Tunisian parts ideally, but passing whole text is fine for fuzzy match
        const correction = await queryDerja('correct', s.text);
        return {
            ...s,
            hint: correction?.result?.corrected || null
        };
    }));

    const systemPrompt = `You are a Tunisian Arabic dialect expert specializing in text correction.
    Task: Correct spelling and transcription errors in the "text" field of the provided segments.
    
    Context:
    - The text is a raw transcription from Whisper (Tunisian Dialect + French/English).
    - It contains spelling mistakes, phonetic errors, and incorrect word splitting.

    Rules:
    1. Fix SPELLING errors in Tunisian Arabic (e.g., "نحب" instead of "n7eb" if written in Arabic script, or standardizing dialect spelling).
    2. CORRECT common dialect mistakes using the provided 'hints' if they make sense.
    3. DO NOT Normalize to Modern Standard Arabic (MSA) yet. Keep it in Tunisian Dialect (Derja).
    4. PRESERVE French and English words EXACTLY as they are (Code-Switching).
    5. Do NOT change the meaning.
    6. Return a JSON object with "segments".

    Example:
    - Input: "ena n7eb nemchi l school" -> Output: "أنا نحب نمشي ل school" (if script unification is desired) or "ena n7eb nemchi l school" -> "ana n7eb nemchi l school" (if keeping requests).
    - BETTER STRATEGY: Default to Arabic Script for Tunisian terms if the input is already mostly Arabic.
    - Input: "ياخي win machin?" -> Output: "ياخي win machin؟"

    Hints:
    - Use the 'hint' field provided in the input as a strong suggestion for the correct spelling of Tunisian phrases.
    `;

    try {
        const completion = await groq.chat.completions.create({
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: JSON.stringify({ segments: enhancedSegments.map(s => ({ start: s.start, end: s.end, text: s.text, hint: s.hint })) }) }
            ],
            model: "llama-3.3-70b-versatile",
            temperature: 0,
            response_format: { type: "json_object" },
        });

        const content = completion.choices[0]?.message?.content;
        const parsed = JSON.parse(content);
        const corrected = parsed.segments || (Array.isArray(parsed) ? parsed : null);

        if (Array.isArray(corrected) && corrected.length === segments.length) {
            return segments.map((s, i) => ({
                ...s,
                text: corrected[i].text || s.text
            }));
        }
        console.warn("Correction length mismatch, returning original segments.");
        return segments;
    } catch (e) {
        console.error("Correction logic failed:", e);
        return segments;
    }
};

const refineTunisianSegments = async (segments) => {
    console.log(`Refining Tunisian Transcription with GitHub Models... (${segments.length} segments)`);

    const token = process.env.GITHUB_MODELS_TOKEN;
    const modelId = process.env.GITHUB_MODELS_ID || 'gpt-4o';

    if (!token) {
        console.warn("GITHUB_MODELS_TOKEN not set, skipping refinement.");
        return segments;
    }

    const systemPrompt = `You are an expert linguist specializing in the Tunisian Arabic dialect (Derja) and its code-switching with French/English.
    Task: Review and refine the provided transcription segments from Whisper.
    
    Context:
    - The input is a raw transcription in Tunisian Arabic.
    - Whisper sometimes makes phonetic errors or misinterprets dialectal nuances.
    
    Rules:
    1. Correct spelling and grammar errors in Tunisian Arabic.
    2. Maintain the natural flow of the dialect (Derja).
    3. PRESERVE all French and English words exactly as they are (Code-Switching).
    4. Ensure timestamps (start/end) remain unchanged.
    5. Return ONLY a valid JSON object with the key "segments".
    6. Do NOT normalize to Modern Standard Arabic (MSA) unless requested elsewhere. Keep it as refined Derja.
    
    Output Format:
    {
      "segments": [
        { "start": 0.0, "end": 2.0, "text": "refined text here" },
        ...
      ]
    }`;

    try {
        const response = await fetch("https://models.inference.ai.azure.com/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${token}`
            },
            body: JSON.stringify({
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: JSON.stringify({ segments: segments.map(s => ({ start: s.start, end: s.end, text: s.text })) }) }
                ],
                model: modelId,
                temperature: 0.1,
                max_tokens: 4096,
                top_p: 1
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`GitHub Models API error: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        const content = data.choices[0]?.message?.content;

        // Clean up markdown code blocks if present
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : content);
        const refined = parsed.segments || (Array.isArray(parsed) ? parsed : null);

        if (Array.isArray(refined) && refined.length === segments.length) {
            return segments.map((s, i) => ({
                ...s,
                text: refined[i].text || s.text
            }));
        }

        console.warn("Refinement returned inconsistent segments or mismatch, returning original.");
        return segments;
    } catch (e) {
        console.error("Tunisian refinement failed:", e);
        return segments;
    }
};

module.exports = {
    translateSegments,
    normalizeSegments,
    correctSegments,
    refineTunisianSegments,
    groq
};

