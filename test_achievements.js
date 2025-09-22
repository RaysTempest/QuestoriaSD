/*
  Lightweight smoke test for Achievements UI
  - Load this script from the browser console while the app is open (index.html)
  - It will try to: open the achievements modal, force-award the first achievement for the active user's jenjang,
    and then assert that the card element shows an unlocked state (class / pill text).

  Usage:
    1. Open index.html in a browser and log in / select a user.
    2. From DevTools Console run: load('/test_achievements.js') or paste the file contents and run.

  It prints PASS/FAIL messages to the console.
*/
(function(){
  try {
    if (!window.activeUser) { console.warn('No activeUser detected — select a user first in the UI.'); return; }
    const jen = activeUser.jenjang || 'sd';
    console.log('Detected jenjang:', jen);

    // open achievements modal
    if (typeof showModal === 'function') showModal('achievements-modal');

    // wait a moment for modal render
    setTimeout(()=>{
      try {
        const achSelect = document.getElementById('achievements-jenjang-select');
        if (achSelect) achSelect.value = jen;
        // find first definition from achievementsDefinitions
        const defs = (window.achievementsDefinitions && achievementsDefinitions[jen]) ? achievementsDefinitions[jen] : [];
        if (!defs || defs.length === 0) { console.warn('No achievement definitions found for', jen); return; }
        const first = defs[0];
        console.log('Forcing award of:', first.id, first.title);
        // call forceAwardAchievement
        if (typeof forceAwardAchievement === 'function') {
          forceAwardAchievement(first.id, jen);
        } else if (typeof spawnBadgeUnlock === 'function') {
          // fallback: directly spawn
          spawnBadgeUnlock(first.id, first.title, first.id);
        } else { console.error('No award function available'); return; }

        // after short delay check DOM
        setTimeout(()=>{
          const card = document.getElementById('achievement-'+first.id);
          const pill = card ? card.querySelector('.achievement-pill') : null;
          const unlocked = card && (card.classList.contains('unlocked') || card.classList.contains('unlocked-badge'));
          const pillText = pill ? pill.textContent.trim() : '(no pill)';
          console.log('DOM check: unlocked=', unlocked, 'pill=', pillText);
          if (unlocked && /terklaim/i.test(pillText)) console.log('%cSMOKE TEST PASS: Achievement visually unlocked', 'color:green;font-weight:bold');
          else console.error('SMOKE TEST FAIL: achievement card not showing unlocked state (unlocked=', unlocked, ', pill=', pillText, ')');
        }, 900);
      } catch(e) { console.error('Test error', e); }
    }, 300);
  } catch (e) { console.error('Test setup error', e); }
})();
