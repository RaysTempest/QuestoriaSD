// EDU-PATCH.JS
// Purpose: Add AI tutor, shop fixes, audio manager, new tools, and mobile/responsive enhancements.
(function(){
    'use strict';

    /* ---------- Utilities ---------- */
    const qs = s => document.querySelector(s);
    const qsa = s => Array.from(document.querySelectorAll(s));
    const storage = window.localStorage;
    function getJSON(k, def){ try { return JSON.parse(storage.getItem(k)) || def; } catch(e){ return def; } }
    function setJSON(k,v){ storage.setItem(k, JSON.stringify(v)); }

    /* ---------- Simple AI Tutor (offline, rule-based) ---------- */
    const ai = {
        // build topic list from edu data if available
        topics: [],
        initTopics(){
            try{
                const data = window.edukasiData || {};
                ['sd','smp','sma','kuliah'].forEach(j=>{
                    const worlds = (data[j] && data[j].dunia) ? Object.values(data[j].dunia) : [];
                    worlds.forEach(w=> this.topics.push({jenjang:j, name: w.namaDunia}));
                });
                // dedupe
                this.topics = this.topics.filter((v,i,a)=> a.findIndex(x=>x.name===v.name)===i);
            }catch(e){ console.warn('AI: failed to init topics', e); }
        },
        answer(prompt, topic){
            // Very small offline "AI": use keywords to answer, fallback to summary from topic content
            prompt = (prompt||'').toLowerCase();
            if(!prompt) return 'Silakan ketik pertanyaan atau minta ringkasan.';
            // quick intents
            if(prompt.includes('ringkas') || prompt.includes('rangkuman') || prompt.includes('ringkasan')){
                return this.summaryFor(topic) || 'Maaf, ringkasan untuk topik ini belum tersedia.';
            }
            if(prompt.includes('buat soal') || prompt.includes('kuis')){
                return this.makeQuickQuiz(topic, 3);
            }
            if(prompt.includes('jelas') || prompt.includes('apa itu') || prompt.includes('jelaskan')){
                return this.shortExplain(prompt, topic);
            }
            // fallback: produce study tips + example
            return this.genericHelp(prompt, topic);
        },
        summaryFor(topic){
            try{
                const data = window.edukasiData || {};
                // find topic by name
                for(const jen of ['sd','smp','sma','kuliah']){
                    const d = data[jen] && data[jen].dunia ? data[jen].dunia : {};
                    for(const key of Object.keys(d)){
                        const w = d[key];
                        if(w.namaDunia === topic) {
                            // collect top 3 subMateri titles
                            const subs = Object.values(w.subMateri||{}).slice(0,3).map(s=>`- ${s.judul}: ${s.funFact||''}`);
                            return `Ringkasan singkat untuk ${w.namaDunia}: ${w.deskripsi}\nTopik unggulan:\n${subs.join('\n')}`;
                        }
                    }
                }
                return null;
            }catch(e){ return null; }
        },
        makeQuickQuiz(topic, n=3){
            try{
                const data = window.edukasiData || {};
                // pick a random submateri from matching topic name
                const pool = [];
                for(const jen of ['sd','smp','sma','kuliah']){
                    const d = data[jen] && data[jen].dunia ? data[jen].dunia : {};
                    for(const key of Object.keys(d)){
                        const w = d[key];
                        if(!topic || w.namaDunia===topic) {
                            for(const sub of Object.values(w.subMateri||{})){
                                if(sub.kuis && sub.kuis.length) pool.push(...sub.kuis.map(k=>({q:k.pertanyaan, pilihan:k.pilihan, jawaban:k.jawaban}))); 
                            }
                        }
                    }
                }
                if(!pool.length) return 'Tidak ada pertanyaan yang tersedia untuk topik ini.';
                // pick n random
                const picked = [];
                while(picked.length < n && pool.length){
                    const i = Math.floor(Math.random()*pool.length);
                    picked.push(pool.splice(i,1)[0]);
                }
                return picked.map((p,idx)=>`${idx+1}. ${p.q}\nPilihan: ${p.pilihan.join(', ')}\nJawaban: ${p.jawaban}`).join('\n\n');
            }catch(e){ return 'Gagal membuat kuis cepat.'; }
        },
        shortExplain(prompt, topic){
            // try to parse a keyword like 'perkalian' or 'penjumlahan'
            const words = prompt.split(/[^a-zA-Z0-9_]+/).filter(Boolean);
            const keywords = ['penjumlahan','pengurangan','perkalian','pembagian','pecahan','aljabar','sel','fotosintesis','tumbuhan','hewan','jarak','waktu','peluang','statistika'];
            for(const k of keywords){ if(words.includes(k)) return `Penjelasan singkat tentang ${k}: (ini penjelasan singkat dan sederhana untuk anak). Coba minta contoh soal atau jelaskan lagi dengan tingkat kesulitan yang berbeda.`; }
            return this.genericHelp(prompt, topic);
        },
        // history store (simple)
        saveToHistory(prompt, reply, topic){
            try{
                const h = getJSON('edu_ai_history', []);
                h.unshift({prompt, reply, topic, at: Date.now()});
                setJSON('edu_ai_history', h.slice(0,200));
            }catch(e){ console.warn('save history failed', e); }
        },
        loadHistory(){ return getJSON('edu_ai_history', []); },
        genericHelp(prompt, topic){
            return `Saya membantu belajar: coba minta 'ringkasan', 'buat soal', atau tanyakan kata kunci spesifik seperti 'perkalian'.\nPermintaan: "${prompt}"\nTopik: "${topic||'Umum'}"`;
        }
    };

    /* ---------- Audio Manager (robust) ---------- */
    const AudioManager = (function(){
        const bg = qs('#background-music');
        let sfxContext = null; // WebAudio for sfx
        let bgmBuffer = null;
        const sfxBuffers = {};
        const defaultSfx = {
            'sfx_click_soft': null,
            'sfx_error': null
        };

        function ensureContext(){
            if(!sfxContext){
                try{ sfxContext = new (window.AudioContext || window.webkitAudioContext)(); }
                catch(e){ console.warn('WebAudio not available', e); sfxContext = null; }
            }
        }

        // Try to load bgm into AudioContext buffer for more reliable playback/control.
        async function tryPreloadBGM(){
            try{
                ensureContext();
                if(!sfxContext) return null;
                const src = (bg && bg.currentSrc) ? bg.currentSrc : (bg && bg.querySelector('source')?.src) || (bg && bg.src);
                if(!src) return null;
                // fetch and decode, but keep this best-effort (may fail due to CORS)
                const res = await fetch(src, { method: 'GET' });
                const ab = await res.arrayBuffer();
                bgmBuffer = await sfxContext.decodeAudioData(ab);
                return bgmBuffer;
            }catch(e){ console.warn('preload bgm failed', e); bgmBuffer = null; return null; }
        }

        // Play bgm: prefer HTMLAudio element (handles loop & mobile nicely), but if that fails, play via buffer
        function playBGM(){
            try{
                // prefer HTMLAudio because it handles autoplay policies with user gesture
                if(bg){
                    const p = bg.play();
                    if(p && p.catch) p.catch(err=>{ console.warn('bgm element play failed, will try buffer fallback', err); // try buffer fallback
                        if(sfxContext && bgmBuffer){ playBgmFromBuffer(); }
                    });
                } else if(sfxContext && bgmBuffer){ playBgmFromBuffer(); }
            }catch(e){ console.warn(e); }
        }

        function pauseBGM(){
            try{
                if(bg && !bg.paused) bg.pause();
                // if playing via buffer we'll stop by closing context (simple approach)
                // NOTE: we intentionally do not close context to allow resume on gesture
            }catch(e){}
        }

        function playBgmFromBuffer(){
            try{
                if(!sfxContext || !bgmBuffer) return;
                const src = sfxContext.createBufferSource();
                src.buffer = bgmBuffer;
                src.loop = true;
                const gain = sfxContext.createGain();
                gain.gain.value = 0.25;
                src.connect(gain).connect(sfxContext.destination);
                // store on the context so we can stop later if needed
                if(sfxContext._bgmSource){ try{ sfxContext._bgmSource.stop(); }catch(e){} }
                sfxContext._bgmSource = src;
                src.start(0);
            }catch(e){ console.warn('playBgmFromBuffer failed', e); }
        }

        async function loadSfxFromUrl(id, url){
            try{
                ensureContext();
                if(!sfxContext) return Promise.reject('no context');
                const r = await fetch(url, { method: 'GET' });
                const ab = await r.arrayBuffer();
                const buf = await sfxContext.decodeAudioData(ab);
                sfxBuffers[id] = buf; return buf;
            }catch(err){
                // fallback: keep null and let playSfx try HTMLAudio
                console.warn('loadSfxFromUrl failed for', id, err);
                return Promise.reject(err);
            }
        }

        function playSfx(id, opts={volume:1}){
            try{
                ensureContext();
                if(sfxBuffers[id] && sfxContext){
                    const src = sfxContext.createBufferSource();
                    src.buffer = sfxBuffers[id];
                    const gain = sfxContext.createGain();
                    gain.gain.value = opts.volume||1;
                    src.connect(gain).connect(sfxContext.destination);
                    src.start(0);
                } else {
                    // fallback: if we have an explicit file URL in defaultSfx use HTMLAudio, otherwise use oscillator preview
                    if(defaultSfx[id]){
                        const html = new Audio(); html.src = defaultSfx[id]; html.volume = opts.volume||1; html.play().catch(()=>{});
                    } else {
                        // graceful oscillator fallback
                        try{ safePlayPreview(id); }catch(e){ /* ignore */ }
                    }
                }
            }catch(e){ console.warn('playSfx error', e); }
        }

        function safePlayPreview(key){ // for bgm previews or sfx previews
            try{ ensureContext(); if(sfxContext){ const o = sfxContext.createOscillator(); const g = sfxContext.createGain(); o.frequency.value = 440; g.gain.value = 0.03; o.connect(g); g.connect(sfxContext.destination); o.start(); setTimeout(()=>{ try{ o.stop(); }catch(e){} }, 300); } }
            catch(e){ console.warn('preview failed', e); }
        }

        // expose a small API
        return { playBGM, pauseBGM, loadSfxFromUrl, playSfx, safePlayPreview, tryPreloadBGM };
    })();

    /* ---------- Shop Fixes: ensure purchase gating and persistence ---------- */
    const Shop = (function(){
        const purchases = getJSON('purchases', {});
        function isOwned(key){ return !!purchases[key]; }
        function buy(key, price){
            const pts = Number(getJSON('player_points', 0));
            if(isOwned(key)) return {ok:false, msg:'Sudah dimiliki'};
            if(pts < price) return {ok:false, msg:'Poin tidak cukup'};
            // deduct and persist
            setJSON('player_points', pts - price);
            purchases[key]= { boughtAt: Date.now(), price };
            setJSON('purchases', purchases);
            // trigger UI update event
            window.dispatchEvent(new CustomEvent('shop:purchase',{detail:{key,price}}));
            return {ok:true};
        }
        function useItem(key){ if(!isOwned(key)) return {ok:false, msg:'Belum dibeli'}; // perform effect in app
            window.dispatchEvent(new CustomEvent('shop:use',{detail:{key}})); return {ok:true}; }
        function getOwned(){ return Object.assign({}, purchases); }
        return { isOwned, buy, useItem, getOwned };
    })();

    /* ---------- 10 New Features / Tools (small, safe additions) ---------- */
    function addNewFeatures(){
        // Create a single responsive floating toolbar to host all quick tools
        const toolbar = document.createElement('div'); toolbar.id = 'edu-floating-toolbar';
        toolbar.style.cssText = 'position:fixed;right:12px;bottom:12px;display:flex;flex-direction:column;gap:8px;align-items:flex-end;z-index:1100;max-width:320px;';
        document.body.appendChild(toolbar);

        function addToolbarButton(opts){ const btn = document.createElement('button'); btn.type='button'; btn.className = 'edu-toolbar-btn'; btn.title = opts.title || ''; btn.innerHTML = opts.label || '•'; btn.style.cssText = 'min-width:44px;min-height:44px;padding:8px 10px;border-radius:10px;border:0;box-shadow:0 8px 18px rgba(0,0,0,0.12);background:'+ (opts.bg||'#444') +';color:#fff;font-size:14px;'; if(opts.onClick) btn.addEventListener('click', opts.onClick); toolbar.appendChild(btn); return btn; }

        // 1. Quick Notes (localStorage)
        const notesKey = 'edu_notes';
        const notesEl = document.createElement('div'); notesEl.id='quick-notes'; notesEl.style.cssText='position:fixed;left:12px;bottom:12px;z-index:220;background:var(--card-bg-color);padding:10px;border-radius:10px;max-width:320px;box-shadow:0 8px 24px rgba(0,0,0,0.12);';
        notesEl.innerHTML = `<div style="font-weight:700;margin-bottom:6px;">Catatan Cepat</div><textarea id="quick-notes-area" rows="4" style="width:100%;border-radius:8px;padding:6px;resize:vertical;background:var(--bg-color);"></textarea><div style="display:flex;gap:6px;margin-top:6px;"><button id="save-note-btn" style="flex:1;background:#2563eb;color:#fff;padding:6px;border-radius:8px;">Simpan</button><button id="clear-note-btn" style="flex:1;background:#9ca3af;color:#fff;padding:6px;border-radius:8px;">Bersihkan</button></div>`;
        document.body.appendChild(notesEl);
        const quickArea = qs('#quick-notes-area');
        quickArea.value = getJSON(notesKey,'');
        qs('#save-note-btn').addEventListener('click', ()=>{ setJSON(notesKey, quickArea.value); showToast('Catatan disimpan'); });
        qs('#clear-note-btn').addEventListener('click', ()=>{ quickArea.value=''; setJSON(notesKey,''); showToast('Catatan dibersihkan'); });

        // Helper: generate flashcards
        function generateFlashcards(){ try{ const cur = window.currentMateriKey; if(!cur) return []; const el = qs('#materi-content'); if(!el) return []; const q = el.querySelector('h1,h2,h3')?.textContent || ''; const p = el.querySelector('p')?.textContent || ''; if(!q && !p) return []; return [{q: q || 'Topik', a: p || 'Konten'}]; }catch(e){return [];} }

        // 2. Flashcards
        addToolbarButton({ label:'🔖', title:'Flashcards', bg:'#5b21b6', onClick: ()=>{ const cards = generateFlashcards(); if(cards.length){ showModalList('Flashcards Cepat', cards.map(c=>`Q: ${c.q}\nA: ${c.a}`).join('\n\n')); } else showToast('Tidak ada materi terpilih untuk dibuat flashcards'); } });

        // 3. Pomodoro
        let pomoTimer = null;
        function startPomodoro(min){ if(pomoTimer) { clearInterval(pomoTimer); pomoTimer=null; showToast('Pomodoro dibatalkan'); return; } let s = min*60; pomoTimer = setInterval(()=>{ s--; if(s<=0){ clearInterval(pomoTimer); pomoTimer=null; showToast('Sesi selesai! Istirahat 5 menit'); AudioManager.playSfx('sfx_win_chime'); } }, 1000); showToast('Pomodoro dimulai'); }
        addToolbarButton({ label:'⏱️', title:'Pomodoro 25m', bg:'#f59e0b', onClick: ()=> startPomodoro(25) });

        // 4/5. Export & Import
        addToolbarButton({ label:'⬇️', title:'Export data', bg:'#16a34a', onClick: ()=>{ const data = {}; ['purchases','player_points','edu_state'].forEach(k=> data[k]=getJSON(k)); const txt = JSON.stringify(data); const blob = new Blob([txt],{type:'application/json'}); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href=url; a.download='edu-data.json'; a.click(); URL.revokeObjectURL(url); showToast('Data diekspor'); } });
        addToolbarButton({ label:'⬆️', title:'Import data', bg:'#111827', onClick: ()=>{ const inp = document.createElement('input'); inp.type='file'; inp.accept='application/json'; inp.onchange = e=>{ const f = e.target.files[0]; if(!f) return; const r = new FileReader(); r.onload = ()=>{ try{ const obj = JSON.parse(r.result); Object.keys(obj).forEach(k=> setJSON(k,obj[k])); showToast('Data diimport (refresh mungkin diperlukan)'); }catch(err){ showToast('File tidak valid'); } }; r.readAsText(f); }; inp.click(); } });

        // 6. Dark mode toggle
        addToolbarButton({ label:'🌙', title:'Toggle Tema Gelap', bg:'#374151', onClick: ()=>{ document.body.classList.toggle('dark'); setJSON('theme_dark', document.body.classList.contains('dark')); showToast('Tema diperbarui'); } });
        if(getJSON('theme_dark', false)) document.body.classList.add('dark');

        // 7. TTS
        addToolbarButton({ label:'🔊', title:'Bacakan teks', bg:'#4338ca', onClick: ()=>{ const text = (qs('#ai-response')?.textContent || qs('#materi-content')?.textContent || '').trim(); if(!text) return showToast('Tidak ada teks untuk dibacakan'); const u = new SpeechSynthesisUtterance(text); u.lang = 'id-ID'; speechSynthesis.cancel(); speechSynthesis.speak(u); } });

        // 8. Font controls
        addToolbarButton({ label:'A+', title:'Perbesar teks', bg:'#0ea5e9', onClick: ()=>{ const cur = Number(getJSON('ui_font_scale',1)); const next = Math.min(1.6, Math.round((cur+0.1)*10)/10); setJSON('ui_font_scale', next); document.documentElement.style.fontSize = (next*16)+'px'; showToast('Ukuran teks diperbesar'); } });
        addToolbarButton({ label:'A-', title:'Perkecil teks', bg:'#38bdf8', onClick: ()=>{ const cur = Number(getJSON('ui_font_scale',1)); const next = Math.max(0.8, Math.round((cur-0.1)*10)/10); setJSON('ui_font_scale', next); document.documentElement.style.fontSize = (next*16)+'px'; showToast('Ukuran teks diperkecil'); } });
        if(getJSON('ui_font_scale')) document.documentElement.style.fontSize = (Number(getJSON('ui_font_scale',1))*16)+'px';

        // 9. Translator
        const dict = { 'apel':'apple','kucing':'cat','anjing':'dog','rumah':'house','buku':'book' };
        addToolbarButton({ label:'🌐', title:'Terjemahkan kata singkat', bg:'#059669', onClick: ()=>{ const w = prompt('Masukkan kata Indonesia (mis. apel)'); if(!w) return; alert(dict[w.toLowerCase()] || 'Tidak ditemukan'); } });

        // 10. Study minutes tracker (fix style bug and make compact)
        const ptsTrack = getJSON('study_minutes_today', 0);
        const trackEl = document.createElement('div'); trackEl.id = 'edu-study-tracker'; trackEl.style.cssText = 'position:fixed;left:12px;bottom:140px;z-index:1050;background:var(--card-bg-color);padding:8px;border-radius:10px;box-shadow:0 8px 20px rgba(0,0,0,0.12);';
        trackEl.innerHTML = `<div style="font-weight:700">Menit belajar hari ini</div><div id="study-minutes-display">${ptsTrack}</div><div style="display:flex;gap:6px;margin-top:6px"><button id="add-minute" style="padding:6px;background:#10b981;color:#fff;border-radius:6px">+1</button><button id="reset-minutes" style="padding:6px;background:#ef4444;color:#fff;border-radius:6px">Reset</button></div>`;
        document.body.appendChild(trackEl);
        qs('#add-minute').addEventListener('click', ()=>{ const cur=Number(getJSON('study_minutes_today',0))+1; setJSON('study_minutes_today',cur); qs('#study-minutes-display').textContent=cur; showToast('Menit ditambah'); });
        qs('#reset-minutes').addEventListener('click', ()=>{ setJSON('study_minutes_today',0); qs('#study-minutes-display').textContent=0; showToast('Direset'); });

        // Exam simulator
        addToolbarButton({ label:'📝', title:'Simulasi ujian', bg:'#dc2626', onClick: ()=>{ const qsList = collectRandomQuestions(5); if(!qsList.length) return showToast('Tidak ada soal untuk simulasi'); showModalList('Simulasi Singkat', qsList.map((s,i)=>`${i+1}. ${s.q}\nPilihan: ${s.pilihan?.join(', ') || '—'}`).join('\n\n')); } });
        function collectRandomQuestions(n){ try{ const pool=[]; const data = window.edukasiData || {}; for(const jen of ['sd','smp','sma','kuliah']){ const d = data[jen] && data[jen].dunia ? data[jen].dunia : {}; for(const key of Object.keys(d)){ for(const sub of Object.values(d[key].subMateri||{})){ if(sub.kuis) pool.push(...sub.kuis); } } } const out=[]; while(out.length<n && pool.length){ const i=Math.floor(Math.random()*pool.length); out.push(pool.splice(i,1)[0]); } return out; }catch(e){ return []; } }

        // Accessibility: add a small collapse control for very small screens
        const collapse = document.createElement('button'); collapse.textContent = '≡'; collapse.title='Tampilkan / Sembunyikan Alat'; collapse.style.cssText='min-width:44px;min-height:44px;padding:8px;border-radius:10px;border:0;box-shadow:0 8px 18px rgba(0,0,0,0.12);background:#111827;color:#fff;font-size:16px;';
        collapse.addEventListener('click', ()=>{ Array.from(toolbar.children).forEach((c,i)=>{ if(c===collapse) return; c.style.display = (c.style.display==='none') ? '' : 'none'; }); });
        toolbar.insertBefore(collapse, toolbar.firstChild);
    }

    /* ---------- UI Helpers ---------- */
    function showToast(msg, timeout=1800){ const el = document.createElement('div'); el.className='shop-confirm'; el.style.left='50%'; el.style.top='20%'; el.textContent=msg; document.body.appendChild(el); setTimeout(()=> el.remove(), timeout); }
    function showModalList(title, text){ // simple modal
        const existing = qs('#edu-temp-modal'); if(existing) existing.remove(); const m = document.createElement('div'); m.id='edu-temp-modal'; m.className='modal-overlay active'; m.style.zIndex=1200; m.innerHTML=`<div class="modal-content p-6 rounded-2xl" style="background-color:var(--modal-bg-color);max-width:600px;"> <h3 style="font-weight:700;margin-bottom:8px">${title}</h3><pre style="white-space:pre-wrap;max-height:400px;overflow:auto">${text}</pre><div style="text-align:right;margin-top:8px"><button id="edu-temp-close" class="px-3 py-1 rounded bg-gray-200">Tutup</button></div></div>`; document.body.appendChild(m); qs('#edu-temp-close').addEventListener('click', ()=>m.remove()); }

    /* ---------- Wire up AI modal and shop fixes ---------- */
    function initPatch(){
        // AI init
        ai.initTopics();
        const aiBtn = qs('#ai-learn-btn');
        const aiModal = qs('#ai-tutor-modal');
        const aiClose = qs('#close-ai-tutor');
        const aiClose2 = qs('#close-ai-tutor-2');
        const aiSelect = qs('#ai-topic-select');
        const aiPrompt = qs('#ai-prompt');
        const aiResp = qs('#ai-response');
        const aiRun = qs('#ai-run-btn');
        const aiQuiz = qs('#ai-quiz-btn');
        const aiRead = qs('#ai-read-btn');
        const aiSaveNote = qs('#ai-save-note');
        if(aiSelect) {
            ai.topics.forEach(t=>{ const o=document.createElement('option'); o.value=t.name; o.textContent=`${t.name} (${t.jenjang})`; aiSelect.appendChild(o); });
        }
        // add AI history area inside modal (if not present)
        (function ensureAiHistoryUI(){
            const modalContent = aiModal?.querySelector('.modal-content');
            if(!modalContent) return;
            if(!qs('#ai-history-list')){
                const hr = document.createElement('div'); hr.id='ai-history-list'; hr.style.cssText='margin-top:10px;max-height:160px;overflow:auto;padding:8px;border-radius:8px;background:var(--card-bg-color);';
                const header = document.createElement('div'); header.style.fontWeight='700'; header.textContent='Riwayat AI (terakhir)';
                const clearBtn = document.createElement('button'); clearBtn.textContent='Bersihkan'; clearBtn.style.cssText='float:right;background:#ef4444;color:#fff;padding:4px 8px;border-radius:6px;';
                clearBtn.addEventListener('click', ()=>{ setJSON('edu_ai_history', []); renderHistory(); showToast('Riwayat AI dibersihkan'); });
                const hdrWrap = document.createElement('div'); hdrWrap.appendChild(header); hdrWrap.appendChild(clearBtn);
                hr.appendChild(hdrWrap);
                const list = document.createElement('div'); list.id='ai-history-items'; list.style.marginTop='8px'; hr.appendChild(list);
                // insert after response area
                const respWrapper = aiResp?.parentElement;
                if(respWrapper) respWrapper.parentElement.appendChild(hr);
                function renderHistory(){ const listEl = qs('#ai-history-items'); listEl.innerHTML=''; const hist = ai.loadHistory(); if(!hist.length) { listEl.textContent='(kosong)'; return;} hist.slice(0,30).forEach(h=>{ const item = document.createElement('div'); item.style.padding='6px 0'; item.style.borderBottom='1px solid rgba(0,0,0,0.04)'; item.innerHTML = `<div style="font-weight:700">Q: ${h.prompt}</div><div style="color:var(--text-color);font-size:0.95rem">A: ${h.reply}</div><div style="font-size:0.75rem;color:#6b7280">${new Date(h.at).toLocaleString()}</div>`; listEl.appendChild(item); }); }
                renderHistory();
            }
        })();
        aiBtn?.addEventListener('click', ()=>{ aiModal.style.display='flex'; aiModal.classList.add('active'); });
        [aiClose, aiClose2].forEach(b=>b?.addEventListener('click', ()=>{ aiModal.style.display='none'; aiModal.classList.remove('active'); }));
        aiRun?.addEventListener('click', ()=>{
            const prompt = aiPrompt.value; const topic = aiSelect.value || null; aiResp.textContent = 'Memproses...'; setTimeout(()=>{ aiResp.textContent = ai.answer(prompt, topic); }, 200);
            // save history
            setTimeout(()=>{ const reply = aiResp.textContent || ''; ai.saveToHistory(prompt, reply, aiSelect.value||null); const render = qs('#ai-history-items'); if(render){ const ev = new Event('renderHist'); render.dispatchEvent(ev); } }, 400);
        });
        aiQuiz?.addEventListener('click', ()=>{ const topic = aiSelect.value || null; aiResp.textContent='Membuat kuis...'; setTimeout(()=>{ aiResp.textContent = ai.makeQuickQuiz(topic,3); },200); });
        aiRead?.addEventListener('click', ()=>{ const t = aiResp.textContent || ''; if(!t) return showToast('Tidak ada teks'); const u=new SpeechSynthesisUtterance(t); u.lang='id-ID'; speechSynthesis.speak(u); });
        aiSaveNote?.addEventListener('click', ()=>{ const text = aiResp.textContent || ''; if(!text) return showToast('Tidak ada yang disimpan'); const notes=getJSON('edu_ai_notes',[]); notes.push({text, at:Date.now()}); setJSON('edu_ai_notes',notes); showToast('Jawaban AI disimpan ke catatan'); });

        // listen for purchase events and update displays
        window.addEventListener('shop:purchase', (ev)=>{
            try{ const ptsEl = qs('#generic-shop-points'); if(ptsEl) ptsEl.textContent = getJSON('player_points',0) + ' Pts'; const shopPoints = qs('#shop-points-display'); if(shopPoints) shopPoints.textContent = getJSON('player_points',0) + ' Pts'; }catch(e){}
        });

        // ensure shop points displays are reactive
        const initialPoints = getJSON('player_points', 0);
        if(getJSON('player_points', null) === null) setJSON('player_points', initialPoints);

        // Shop wiring: ensure generic-shop-container shows items and respects ownership
        function showGenericShop(shopKey){
            const shop = shopData[shopKey] || shopData['bgmStore'] || shopData['tokoAvatar'];
            const container = qs('#generic-shop-container'); const title = qs('#generic-shop-title'); const points = qs('#generic-shop-points');
            container.innerHTML=''; title.textContent = shop.title; points.textContent = getJSON('player_points',0) + ' Pts';
            for(const [k,v] of Object.entries(shop.items)){
                const itemKey = k;
                const card = document.createElement('div'); card.className='shop-item p-3'; card.style.cursor='pointer'; card.innerHTML=`<div style="font-size:32px">${v.icon||'🎁'}</div><div style="font-weight:700">${v.name||v.title||k}</div><div class="price-tag">${v.price||v.cost||0} 🎯</div>`;
                if(Shop.isOwned(itemKey)) { card.classList.add('owned'); const useBtn = document.createElement('button'); useBtn.className='mt-2 px-3 py-1 rounded bg-amber-300'; useBtn.textContent='Gunakan'; useBtn.addEventListener('click', ()=>{ const r=Shop.useItem(itemKey); if(!r.ok) showToast(r.msg); else showToast('Item digunakan'); }); card.appendChild(useBtn); }
                else { card.classList.add('locked'); card.addEventListener('click', ()=>{ if(confirm(`Beli ${v.name} seharga ${v.price} poin?`)){ const r=Shop.buy(itemKey, v.price||0); if(!r.ok) showToast(r.msg); else { showToast('Pembelian berhasil'); showGenericShop(shopKey); } } }); }
                container.appendChild(card);
            }
            qs('.generic-shop-close-btn')?.addEventListener('click', ()=> qs('#generic-shop-modal').classList.remove('active'));
            qs('#generic-shop-modal').classList.add('active'); qs('#generic-shop-modal').style.display='flex';
        }
        // hook shop hub buttons
        qsa('#open-avatar-shop,#open-customization-shop,#open-burunghantu-shop,#open-bonus-shop,#open-bgm-shop,#open-sfx-shop').forEach(el=>{
            el.addEventListener('click', (e)=>{
                const id = e.currentTarget.id;
                if(id==='open-avatar-shop') showGenericShop('tokoAvatar');
                else if(id==='open-customization-shop') showGenericShop('customization');
                else if(id==='open-burunghantu-shop') showGenericShop('tokoBurungHantu');
                else if(id==='open-bonus-shop') showGenericShop('tokoBonus');
                else if(id==='open-bgm-shop') showGenericShop('bgmStore');
                else if(id==='open-sfx-shop') showGenericShop('sfxStore');
            });
        });

        // Ensure inventory modal lists owned items
        const inventoryBtn = qs('#inventory-btn'); inventoryBtn?.addEventListener('click', ()=>{ const list = qs('#inventory-list'); list.innerHTML=''; const owned = Shop.getOwned(); if(!Object.keys(owned).length) list.innerHTML='<div>Tidak ada item</div>'; for(const k of Object.keys(owned)){ const li = document.createElement('div'); li.className='p-2 shop-item'; li.textContent = `${k} (${owned[k].price} pts)`; const use = document.createElement('button'); use.textContent='Gunakan'; use.className='ml-2 px-2 py-1 bg-amber-300 rounded'; use.addEventListener('click', ()=>{ const r=Shop.useItem(k); if(!r.ok) showToast(r.msg); else showToast('Item digunakan'); }); li.appendChild(use); list.appendChild(li); } qs('#inventory-modal').classList.add('active'); qs('#inventory-modal').style.display='flex'; });

        // background music error handling
    try{ const bgEl = qs('#background-music'); if(bgEl){ bgEl.addEventListener('error', ()=>{ console.warn('background music failed to load'); setJSON('music_muted', true); showToast('Musik latar gagal dimuat - dimatikan'); }); } }catch(e){ }


        // Play/pause background music based on setting
        const musicToggle = qs('#music-toggle');
        musicToggle?.addEventListener('click', async ()=>{
            const muted = getJSON('music_muted', false);
            if(muted){
                setJSON('music_muted', false);
                // try to resume audio context if needed
                try{ if(typeof AudioManager.tryPreloadBGM === 'function') await AudioManager.tryPreloadBGM(); }catch(e){}
                AudioManager.playBGM(); showToast('Musik diputar');
            } else { setJSON('music_muted', true); AudioManager.pauseBGM(); showToast('Musik dihentikan'); }
        });

        // Attempt to preload BGM buffer (best-effort). If it fails due to CORS or autoplay policy, we'll fallback to element playback.
        (async function tryPreload(){ try{ await AudioManager.tryPreloadBGM(); // if not muted, attempt to play
                if(!getJSON('music_muted', false)) { AudioManager.playBGM(); }
            }catch(e){ /* ignore */ } })();

        // If audio fails due to autoplay policy on mobile, offer a single-tap resume prompt
        function setupUserGestureResume(){
            const resumeOnce = async ()=>{
                try{ if(typeof AudioManager.tryPreloadBGM === 'function') await AudioManager.tryPreloadBGM(); }catch(e){}
                try{ AudioManager.safePlayPreview('sfx_click_soft'); if(!getJSON('music_muted', false)) AudioManager.playBGM(); }catch(e){}
                // remove listener after first gesture
                window.removeEventListener('touchstart', resumeOnce);
                window.removeEventListener('click', resumeOnce);
            };
            window.addEventListener('touchstart', resumeOnce, {passive:true});
            window.addEventListener('click', resumeOnce);
        }
        setupUserGestureResume();

        // fix: sounds with missing sources - try to preload bounding ones
        // We won't perform network fetches for external assets beyond best-effort preload; use safePlayPreview to avoid crash
        window.addEventListener('error', (ev)=>{ console.warn('window error', ev.message); });

        // Mobile-specific UI polish: make shop and inventory modals scrollable and enlarge header actions
        ['#shop-hub-modal','#avatar-shop-modal','#inventory-modal','#purchase-history-modal','#ai-tutor-modal','#shop-hub-modal'].forEach(id=>{
            const m = qs(id); if(m){ const mc = m.querySelector('.modal-content'); if(mc){ mc.style.maxHeight='85vh'; mc.style.overflowY='auto'; mc.style.padding='14px'; } }
        });

        // enlarge header action buttons on small screens for easier tapping
        if(window.innerWidth <= 520){ qsa('header button, .modal-content button').forEach(b=>{ try{ b.style.padding='12px 14px'; b.style.fontSize='16px'; b.style.minWidth='48px'; b.style.minHeight='44px'; }catch(e){} });
            // increase AI textarea height
            const aiPrompt = qs('#ai-prompt'); if(aiPrompt) aiPrompt.rows = Math.max(4, Math.floor(window.innerHeight/200));
            // add a visible floating music toggle on mobile if not already present
            if(!qs('#mobile-music-toggle')){
                const mt = document.createElement('button'); mt.id='mobile-music-toggle'; mt.style.cssText='position:fixed;left:12px;top:12px;z-index:1200;background:#111827;color:#fff;padding:10px;border-radius:10px;box-shadow:0 8px 20px rgba(0,0,0,0.18);'; mt.textContent = getJSON('music_muted', false) ? 'Musik: Mati' : 'Musik: On';
                mt.addEventListener('click', ()=>{ const muted=getJSON('music_muted',false); if(muted){ setJSON('music_muted', false); AudioManager.playBGM(); mt.textContent='Musik: On'; showToast('Musik diputar'); } else { setJSON('music_muted', true); AudioManager.pauseBGM(); mt.textContent='Musik: Mati'; showToast('Musik dihentikan'); } }); document.body.appendChild(mt);
            }
        }

        // small responsive improvements: ensure modal content fits small screens and touch targets are larger
        qsa('.modal-content').forEach(m=>{ m.style.maxHeight = '80vh'; m.style.overflowY = 'auto'; });
        if(window.innerWidth < 720){ // mobile tweaks
            qsa('.modal-content').forEach(m=> m.style.padding='12px');
            // enlarge header buttons and action buttons for easier tapping
            qsa('button').forEach(b=>{ try{ const cs = window.getComputedStyle(b); const h = parseInt(cs.height)||0; if(h < 40) b.style.padding = '12px 14px'; }catch(e){} });
        }

        // initialize new features UI
        addNewFeatures();

        // load sfx placeholders (using small oscillator fallback)
        AudioManager.safePlayPreview('sfx_click_soft');

        // announce ready
        console.log('edu-patch initialized');
        showToast('Fitur AI & perbaikan toko diaktifkan');
    }

    // wait until DOM ready
    if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', initPatch); else initPatch();

})();
