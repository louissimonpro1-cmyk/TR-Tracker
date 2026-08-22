// One-off VAPID key pair for the push notifications: `npm run vapid`.
// The pair identifies this deployment to the browsers' push services. Generate it
// once, paste both values into the environment, and never share the private key.
import { generateVapidKeys } from "../lib/push.mjs";

const { publicKey, privateKey } = generateVapidKeys();
console.log(`
Cles VAPID generees. Ajoutez-les aux variables d'environnement du projet
(Vercel : Settings -> Environment Variables, puis redeployez) :

VAPID_PUBLIC_KEY=${publicKey}
VAPID_PRIVATE_KEY=${privateKey}
VAPID_SUBJECT=mailto:votre.email@example.com

Gardez VAPID_PRIVATE_KEY secrete. Si vous la regenerez, tous les appareils
deja abonnes devront reactiver les notifications.
`);
