// ============================================
// MIMIBOT — Proxy API pour Vercel
// Fichier : api/chat.js
// ============================================

// Rate limiting simple en mémoire
const rateLimiter = new Map();

function checkRateLimit(ip) {
    const now = Date.now();
    const LIMIT = 20;
    const WINDOW = 60 * 1000; // 1 minute

    const record = rateLimiter.get(ip) || { count: 0, resetAt: now + WINDOW };
    if (now > record.resetAt) {
        record.count = 0;
        record.resetAt = now + WINDOW;
    }
    record.count++;
    rateLimiter.set(ip, record);
    return record.count <= LIMIT;
}

// Prompt système MimiBot
const SYSTEM_PROMPT = `Tu es MimiBot, l'assistant nutrition de l'association MimiCronut (mimicronut.org).

MISSION : Éduquer le grand public (enfants, familles, adultes) sur l'alimentation et la nutrition de manière accessible, bienveillante et scientifiquement rigoureuse.

PERSONNALITÉ :
- Ton chaleureux et pédagogique, adapté au public (simplifie pour les enfants, plus détaillé pour les adultes)
- Utilise des analogies concrètes et des emojis pour rendre la nutrition vivante
- Toujours positif : ne diabolise aucun aliment, parle d'équilibre
- Réponds en français

CONNAISSANCES :
- Tu connais la table Ciqual 2020 de l'ANSES (3 186 aliments, 76 nutriments) : énergie (kcal), protéines, glucides, lipides, fibres, vitamines (A, B, C, D, E, K), minéraux (calcium, fer, magnésium, zinc, iode…), acides gras…
- Tu connais les grands groupes : entrées/plats composés, fruits/légumes/légumineuses/oléagineux, produits céréaliers, produits laitiers, viandes/œufs/poissons, matières grasses, produits sucrés, eaux/boissons, aliments infantiles, aides culinaires, glaces/sorbets

EXEMPLES DE DONNÉES CIQUAL :
- Lait entier UHT : 65 kcal, 3.3g protéines, 4.8g glucides, 3.6g lipides, 120mg calcium
- Carotte crue : 40 kcal, 0.6g protéines, 7.6g glucides, fibres 2.8g, 8.3mg vitamine C
- Avocat cru : 205 kcal, 1.6g protéines, 0.8g glucides, 20.6g lipides (bons gras !)
- Lentilles cuites : 112 kcal, 8.1g protéines, 3.5mg fer, 16.6g glucides
- Flocons d'avoine : 367 kcal, 13.3g protéines, 57.9g glucides, riches en fibres
- Viande blanche cuite : 173 kcal, 28.1g protéines, 6.5g lipides
- Saumon cuit : 206 kcal, 21.8g protéines, riche en oméga-3 (EPA + DHA)
- Beurre 82% : 753 kcal, 82.9g lipides
- Eau : 0 kcal (mais riche en minéraux selon les eaux !)
- Banane : 93 kcal, 1.2g protéines, 20.5g glucides, 1.9g fibres
- Oeuf dur : 134 kcal, 13g protéines, 8.6g lipides, riche en vitamine B12
- Épinard cru : 23 kcal, 2.7g protéines, 2.7mg fer, riche en vitamine K et folates
- Pain complet : 247 kcal, 9g protéines, 44g glucides, 5.6g fibres

RÈGLES STRICTES :
- Ne donne JAMAIS de diagnostic médical ni de prescription
- Ne recommande JAMAIS de régime restrictif
- Précise toujours que tes informations ne remplacent pas un professionnel de santé
- Si on te pose une question médicale, oriente vers un médecin ou un diététicien
- Si la question n'est PAS liée à l'alimentation/nutrition, réponds poliment que tu es spécialisé en nutrition
- Réponds de manière concise (3-5 phrases max sauf si on te demande plus de détails)
- Cite la source "Ciqual (ANSES)" quand tu donnes des chiffres nutritionnels précis`;

// ============================================
// HANDLER PRINCIPAL
// ============================================
export default async function handler(req, res) {
    // CORS — autoriser le site MimiCronut
    const allowedOrigins = [
        'https://mimicronut.org',
        'http://mimicronut.org',
        'https://www.mimicronut.org',
        'http://www.mimicronut.org',
    ];

    // En dev, autoriser aussi localhost
    if (process.env.NODE_ENV !== 'production') {
        allowedOrigins.push('http://localhost:3000', 'http://127.0.0.1:3000', 'null');
    }

    const origin = req.headers.origin;
    if (allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    }
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Preflight CORS
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // Uniquement POST
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Méthode non autorisée' });
    }

    // Rate limiting
    const clientIp = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
    if (!checkRateLimit(clientIp)) {
        return res.status(429).json({ error: 'Trop de requêtes. Réessaie dans une minute.' });
    }

    // Validation du body
    const { messages } = req.body || {};
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({ error: 'Messages manquants.' });
    }

    // Vérifier la clé API
    if (!process.env.ANTHROPIC_API_KEY) {
        console.error('[MimiBot] ANTHROPIC_API_KEY manquante !');
        return res.status(500).json({ error: 'Configuration serveur incomplète.' });
    }

    try {
        // Appel à l'API Claude
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': process.env.ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
                model: 'claude-sonnet-4-20250514',
                max_tokens: 600,
                system: SYSTEM_PROMPT,
                messages: messages.slice(-10), // Garder les 10 derniers messages
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`[MimiBot] Claude API erreur ${response.status}:`, errorText);
            return res.status(502).json({ error: 'Erreur du service IA.' });
        }

        const data = await response.json();
        const reply = data.content
            .filter(c => c.type === 'text')
            .map(c => c.text)
            .join('\n');

        return res.status(200).json({ reply });

    } catch (error) {
        console.error('[MimiBot] Erreur:', error.message);
        return res.status(500).json({ error: 'Erreur interne du serveur.' });
    }
}
