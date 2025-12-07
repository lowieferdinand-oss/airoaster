// server.js (expanded for Stripe Checkout, premium roast verification, rate limiting)
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

const OPENAI_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY || ''; // set this in Vercel env
const STRIPE_SUCCESS_URL = process.env.STRIPE_SUCCESS_URL || '/success?session_id={CHECKOUT_SESSION_ID}';

let stripe = null;
if (STRIPE_SECRET) {
  const Stripe = require('stripe');
  stripe = Stripe(STRIPE_SECRET);
} else {
  console.warn('Stripe secret not set. Premium payments will not work until STRIPE_SECRET_KEY is added.');
}

// Rate limiter: basic protection
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // limit each IP to 30 requests per windowMs
  message: { error: 'Te veel verzoeken; probeer het over een minuut opnieuw.' }
});
app.use('/api/', apiLimiter);

const protectedTerms = ["race","religion","ethnicity","gay","lesbian","trans","black","white","jew","muslim","christian","disabled","disability","immigrant","refugee"];
const violentTerms = ["kill","murder","rape","harm","bomb","explode","die"];

function containsBlocked(t){
  const text = (t||'').toLowerCase();
  for(const p of protectedTerms) if(text.includes(p)) return {blocked:true,reason:'protected'};
  for(const v of violentTerms) if(text.includes(v)) return {blocked:true,reason:'violent'};
  return {blocked:false};
}

// Basic roast endpoint (free)
app.post('/api/roast', async (req, res) => {
  try {
    const { target, tone } = req.body || {};
    if (!target || !target.trim()) return res.status(400).json({ error: 'Geef een target op.' });
    const check = containsBlocked(target);
    if (check.blocked) return res.status(400).json({ error: 'Target geblokkeerd.' });

    const safePrompt = `
Je taak: schrijf een humoristische roast van 1-3 korte zinnen gericht op de volgende target.
Regels:
- Geen aanvallen op beschermde groepen (ras, religie, gender, seksuele geaardheid, handicap, nationaliteit).
- Geen oproep tot geweld of bedreigingen.
- Max 280 tekens.
- Tone: ${tone}.
Target: "${target}"
Schrijf enkel de roast.
`;

    if (!OPENAI_KEY) {
      // offline fallback
      const fallback = [
        `${target} lijkt op een update die altijd op het slechtste moment verschijnt.`,
        `${target} is zo traag dat buffering medelijden krijgt.`,
        `${target} heeft meer excuses dan een slechte Wi‑Fi verbinding.`
      ];
      return res.json({ roast: fallback[Math.floor(Math.random()*fallback.length)], note: 'offline fallback (geen OpenAI key)'} );
    }

    const resp = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: OPENAI_MODEL,
      messages: [
        { role: 'system', content: 'You are a witty comedian that creates short, humorous roasts that are sharp but not hateful or violent.' },
        { role: 'user', content: safePrompt }
      ],
      max_tokens: 120,
      temperature: 0.85
    }, {
      headers: { 'Authorization': `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' }
    });

    const roastText = resp.data.choices?.[0]?.message?.content?.trim() || "Probeer opnieuw.";
    const outCheck = containsBlocked(roastText);
    if (outCheck.blocked) return res.status(500).json({ error: 'Gegenereerde tekst werd geblokkeerd door veiligheidssysteem.' });
    res.json({ roast: roastText });

  } catch (err) {
    console.error(err.response ? err.response.data : err.message);
    res.status(500).json({ error: 'Er ging iets mis bij het genereren.' });
  }
});

// Premium routes using Stripe Checkout
// Create a checkout session for a single premium roast credit
app.post('/api/create-checkout-session', async (req, res) => {
  try {
    if (!stripe) return res.status(500).json({ error: 'Stripe niet geconfigureerd op deze server.' });
    // price and product are created on-the-fly using Checkout Session with line_items
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: { name: 'Premium Roast (1 credit)' },
          unit_amount: 199 // €1.99 (199 cents)
        },
        quantity: 1
      }],
      mode: 'payment',
      success_url: `${STRIPE_SUCCESS_URL}`,
      cancel_url: `${req.headers.origin || ''}/`
    });
    res.json({ url: session.url });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Kon geen checkout sessie aanmaken.' });
  }
});

// Verify session on success page (client will call this with session_id)
app.get('/api/verify-session', async (req, res) => {
  try {
    if (!stripe) return res.status(500).json({ error: 'Stripe niet geconfigureerd.' });
    const sessId = req.query.session_id;
    if (!sessId) return res.status(400).json({ error: 'Geen session_id meegegeven.' });
    const session = await stripe.checkout.sessions.retrieve(sessId);
    if (session && session.payment_status === 'paid') {
      // You may implement order fulfillment/DB here. For simplicity we return success=true.
      return res.json({ paid: true });
    } else {
      return res.json({ paid: false });
    }
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Kon sessie niet verifiëren.' });
  }
});

// Premium roast endpoint requires client to prove paid by passing session_id OR secret token
app.post('/api/premium-roast', async (req, res) => {
  try {
    const { target, tone, session_id } = req.body || {};
    if (!target || !target.trim()) return res.status(400).json({ error: 'Geef een target op.' });
    const check = containsBlocked(target);
    if (check.blocked) return res.status(400).json({ error: 'Target geblokkeerd.' });

    // verify session if stripe configured
    if (stripe) {
      if (!session_id) return res.status(400).json({ error: 'Ontbrekende session_id voor premium roast.' });
      const session = await stripe.checkout.sessions.retrieve(session_id);
      if (!session || session.payment_status !== 'paid') return res.status(402).json({ error: 'Betaling niet bevestigd.' });
      // proceed to generate premium roast
    } else {
      // fallback: if stripe not configured, allow premium for demo (in production, disable)
      console.warn('Stripe niet geconfigureerd — premium endpoint accepteert request (DEMO MODE).');
    }

    const premiumPrompt = `
Je taak: schrijf een zeer scherpe, creatieve en virale roast van 1-4 zinnen.
Regels:
- Geen aanvallen op beschermde groepen.
- Geen oproep tot geweld of bedreigingen.
- Max 400 tekens.
- Gebruik humor, pop-culture referenties en korte punchlines.
- Maak het geschikt om als TikTok caption of viral tweet te delen.
Tone: ${tone}.
Target: "${target}"
Schrijf enkel de roast, klaar voor social sharing.
`;

    if (!OPENAI_KEY) {
      return res.json({ roast: `Premium demo: ${target} is zo uniek dat zelfs autocorrect het niet begrijpt.` , note: 'offline fallback' });
    }

    const resp = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: OPENAI_MODEL,
      messages: [
        { role: 'system', content: 'You are a top-tier comedy writer producing viral, concise roasts suitable for social media.' },
        { role: 'user', content: premiumPrompt }
      ],
      max_tokens: 220,
      temperature: 0.95
    }, {
      headers: { 'Authorization': `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' }
    });

    const roastText = resp.data.choices?.[0]?.message?.content?.trim() || "Probeer opnieuw.";
    const outCheck = containsBlocked(roastText);
    if (outCheck.blocked) return res.status(500).json({ error: 'Gegenereerde tekst werd geblokkeerd.' });
    res.json({ roast: roastText });

  } catch (e) {
    console.error(e.response ? e.response.data : e.message);
    res.status(500).json({ error: 'Fout bij premium generatie.' });
  }
});

app.get('/success', (req, res) => {
  // Simple success page (client-side will call verify-session)
  res.sendFile(require('path').join(__dirname, 'public', 'success.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server draait op poort ${PORT}`));