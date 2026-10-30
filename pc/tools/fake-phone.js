// Simule un téléphone pour tester l'application PC sans Android.
// Usage : node tools/fake-phone.js <code de jumelage> [hôte:port]
const WebSocket = require('ws');

const code = process.argv[2];
const target = process.argv[3] || '127.0.0.1:8787';
if (!code) {
  console.error('Usage : node tools/fake-phone.js <code de jumelage> [hôte:port]');
  process.exit(1);
}
const token = code.split('-')[0];

const fs = require('fs');
const path = require('path');
const icon = 'data:image/png;base64,' + fs.readFileSync(path.join(__dirname, '..', 'assets', 'icon.png')).toString('base64');

const now = Date.now();
const threads = [
  { id: 1, address: '+33612345678', name: 'Sarah', snippet: 'On se retrouve à quelle heure ?', date: now - 60000, unread: 1 },
  { id: 2, address: '+33698765432', name: 'Maman', snippet: "Promis, j'apporte le dessert", date: now - 3600000, unread: 0 },
  { id: 3, address: 'LIVRAISON', name: 'Livraison', snippet: 'Votre colis arrive entre 15h et 17h', date: now - 7200000, unread: 0 }
];
const threadMsgs = {
  1: [
    { id: 11, body: 'Salut ! Tu es dispo ce soir ?', date: now - 300000, out: false },
    { id: 12, body: 'Oui, vers 19h ça marche', date: now - 240000, out: true },
    { id: 13, body: 'On se retrouve à quelle heure ?', date: now - 60000, out: false }
  ],
  2: [{ id: 21, body: "Promis, j'apporte le dessert", date: now - 3600000, out: true }],
  3: [{ id: 31, body: 'Votre colis arrive entre 15h et 17h', date: now - 7200000, out: false }]
};

// Le PC utilise un certificat auto-signé : le vrai téléphone vérifie l'empreinte du code de jumelage.
const ws = new WebSocket('wss://' + target, { rejectUnauthorized: false });
const send = (o) => ws.send(JSON.stringify(o));

ws.on('open', () => send({ t: 'hello', token, device: 'Faux téléphone' }));
ws.on('message', (raw) => {
  const m = JSON.parse(raw.toString());
  console.log('<-', m);
  if (m.t === 'welcome') {
    send({ t: 'battery', pct: 78 });
    send({
      t: 'notif', key: 'n1', app: 'WhatsApp', pkg: 'com.whatsapp', icon, title: 'Sarah', text: 'On se retrouve à quelle heure ?', time: now - 60000, canReply: true,
      conv: {
        id: 'com.whatsapp|Sarah', name: 'Sarah', group: false,
        messages: [
          { text: 'Salut ! Tu es dispo ce soir ?', time: now - 300000, sender: 'Sarah', out: false },
          { text: 'Oui, vers 19h', time: now - 240000, sender: 'Moi', out: true },
          { text: 'On se retrouve à quelle heure ?', time: now - 60000, sender: 'Sarah', out: false }
        ]
      }
    });
    send({
      t: 'notif', key: 'n4', app: 'Messenger', pkg: 'com.facebook.orca', icon, title: 'Groupe Famille', text: 'Léa: Je m\'en occupe', time: now - 30000, canReply: true,
      conv: {
        id: 'com.facebook.orca|Groupe Famille', name: 'Groupe Famille', group: true,
        messages: [
          { text: 'Qui apporte le dessert ?', time: now - 90000, sender: 'Maman', out: false },
          { text: 'Moi je prends les boissons', time: now - 60000, sender: 'Karim', out: false },
          { text: 'Je m\'en occupe', time: now - 30000, sender: 'Léa', out: false }
        ]
      }
    });
    send({ t: 'notif', key: 'n2', app: 'Banque', pkg: 'bank', title: 'Paiement carte', text: 'Débit de 24,90 € chez Carrefour', time: now - 3000000, canReply: false });
    send({ t: 'notif', key: 'n3', app: 'Jeu', pkg: 'game.arcade', title: 'Vos vies sont rechargées', text: 'Revenez jouer !', time: now - 1000000, canReply: false });
    setTimeout(() => send({ t: 'sms_new', id: 14, threadId: 1, address: '+33612345678', name: 'Sarah', body: 'Je réserve pour 19h30 ?', date: Date.now() }), 8000);
  }
  if (m.t === 'get_calls') {
    send({
      t: 'calls',
      calls: [
        { id: 3, number: '+33612345678', name: 'Sarah', kind: 'missed', date: now - 900000, duration: 0 },
        { id: 2, number: '+33698765432', name: 'Maman', kind: 'in', date: now - 7200000, duration: 185 },
        { id: 1, number: '+33711223344', name: '+33711223344', kind: 'out', date: now - 86400000, duration: 42 }
      ]
    });
  }
  if (m.t === 'get_threads') send({ t: 'sms_list', threads });
  if (m.t === 'get_thread') send({ t: 'sms_thread', threadId: m.threadId, messages: threadMsgs[m.threadId] || [] });
});
ws.on('close', () => { console.log('Connexion fermée'); process.exit(0); });
ws.on('error', (e) => console.error(e.message));
