import UserIntentMandate from '../models/UserIntentMandate.js';
import PasskeyCredential from '../models/PasskeyCredential.js';
import MandateApprovalChallenge from '../models/MandateApprovalChallenge.js';
import ExecutionReceipt from '../models/ExecutionReceipt.js';
import PasskeyRegistrationChallenge from '../models/PasskeyRegistrationChallenge.js';

let ready = null;

export async function warmAuthorizationPersistence() {
  if (!ready) {
    ready = Promise.all([
      UserIntentMandate.init(),
      PasskeyCredential.init(),
      MandateApprovalChallenge.init(),
      ExecutionReceipt.init(),
      PasskeyRegistrationChallenge.init(),
    ]).catch(error => {
      ready = null;
      throw error;
    });
  }
  await ready;
}
