// Client-side logic: free + premium flow, social share, screenshot
document.addEventListener('DOMContentLoaded', () => {
  const targetEl = document.getElementById('target');
  const presetEl = document.getElementById('preset');
  const genBtn = document.getElementById('gen');
  const genPremiumBtn = document.getElementById('gen-premium');
  const randomBtn = document.getElementById('randomize');
  const resultEl = document.getElementById('result');
  const noteEl = document.getElementById('note');

  const presets = {
    late: "Je bent altijd te laat — roast me",
    lazy: "Je doet alles op 0% batterij",
    tech: "Altijd problemen met je laptop",
    relationship: "Je dates zijn cringier dan je bio"
  };

  randomBtn.addEventListener('click', () => {
    const keys = Object.keys(presets);
    const k = keys[Math.floor(Math.random()*keys.length)];
    presetEl.value = k;
    targetEl.value = presets[k];
  });

  presetEl.addEventListener('change', () => {
    if (presetEl.value) targetEl.value = presets[presetEl.value];
  });

  genBtn.addEventListener('click', async () => {
    await generateRoast('/api/roast');
  });

  genPremiumBtn.addEventListener('click', async () => {
    // Start Stripe Checkout flow
    try {
      const resp = await fetch('/api/create-checkout-session', { method: 'POST' });
      const data = await resp.json();
      if (data.url) {
        // redirect to Stripe Checkout
        window.location = data.url;
      } else {
        noteEl.textContent = 'Kon checkout niet starten: ' + (data.error || 'onbekend');
      }
    } catch (e) {
      noteEl.textContent = 'Netwerkfout bij starten van betaling.';
    }
  });

  // If we are on the success page with ?session_id=... we verify payment and call premium roast
  async function handlePostPayment() {
    const params = new URLSearchParams(window.location.search);
    const sid = params.get('session_id');
    if (!sid) return;
    noteEl.textContent = 'Bezig met verifiëren van betaling...';
    const verify = await fetch('/api/verify-session?session_id=' + encodeURIComponent(sid));
    const ok = await verify.json();
    if (ok.paid) {
      // call premium roast
      await generateRoast('/api/premium-roast', { session_id: sid });
    } else {
      noteEl.textContent = 'Betaling niet bevestigd.';
    }
  }

  async function generateRoast(endpoint, extra={}) {
    const target = targetEl.value.trim();
    const tone = document.querySelector('input[name="tone"]:checked').value;
    if (!target) { resultEl.textContent = 'Typ iets in.'; return; }
    resultEl.textContent = 'Even nadenken...';
    noteEl.textContent = '';
    try {
      const body = Object.assign({ target, tone }, extra);
      const r = await fetch(endpoint, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
      const data = await r.json();
      if (r.ok) {
        resultEl.textContent = data.roast;
        if (data.note) noteEl.textContent = data.note;
      } else {
        resultEl.textContent = 'Fout: ' + (data.error || 'onbekend');
      }
    } catch (e) {
      resultEl.textContent = 'Netwerkfout.';
    }
  }

  // Social share buttons
  document.getElementById('share-twitter').addEventListener('click', () => {
    const text = encodeURIComponent(resultEl.textContent || 'Check deze roast!');
    const url = encodeURIComponent(window.location.href);
    window.open(`https://twitter.com/intent/tweet?text=${text}&url=${url}`, '_blank');
  });

  document.getElementById('share-tiktok').addEventListener('click', async () => {
    // Copy text to clipboard for pasting into TikTok caption
    try {
      await navigator.clipboard.writeText(resultEl.textContent || '');
      noteEl.textContent = 'Roast gekopieerd naar klembord — plak in TikTok caption';
    } catch (e) {
      noteEl.textContent = 'Kon niet kopiëren; selecteer de tekst en kopieer handmatig.';
    }
  });

  // Screenshot
  document.getElementById('screenshot').addEventListener('click', async () => {
    noteEl.textContent = 'Screenshot maken...';
    const el = document.querySelector('.card');
    html2canvas(el).then(canvas => {
      const url = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = url;
      a.download = 'roast.png';
      a.click();
      noteEl.textContent = 'Screenshot gedownload.';
    }).catch(() => { noteEl.textContent = 'Kon geen screenshot maken.'; });
  });

  handlePostPayment();
});