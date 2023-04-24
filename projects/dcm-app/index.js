const AWS = require('aws-sdk');

const client = new AWS.VerifiedPermissions({ region: 'us-east-1' });

(async () => {
  try {
    var policyStoreId = null;

    // List Policy Stores
    const listPolicyStores = await client.listPolicyStores().promise();

    // Create Policy Store if there are no Policy Stores
    if (listPolicyStores.PolicyStores.length === 0) {
      // Create Policy Store if it doesn't exist
      console.log('Creating Policy Store');
      const policyStore = await client.createPolicyStore().promise();
      policyStoreId = policyStore.PolicyStoreId;
      console.log("Policy Store created: " + policyStoreId);
    } else {
      policyStoreId = listPolicyStores.PolicyStores[0].PolicyStoreId;
      console.log('Policy Store already exists with ID: ' + policyStoreId);
    }

    // Read a list of policies from a file
    const fs = require('fs');
    const policyStrings = fs.readFileSync('avpPolicies.txt', 'utf8').split(';');
    const policies = [];
    for (let i = 0; i < policyStrings.length-1; i++) {
        const policyString = policyStrings[i].trim() + ';\n';
        policies.push(policyString);
    }

    console.log('Found ' + policies.length + ' policies');

    // Get the list of policies in the store
    const existingPolicies = await client.listPolicies({PolicyStoreIdentifier: policyStoreId}).promise();
    console.log(existingPolicies.Policies.length + ' policies already exist in the store');

    // Get all policies
    for (let i = 0; i < existingPolicies.Policies.length; i++) {
        const policy = existingPolicies.Policies[i];
        const policyDetails = await client.getPolicy({PolicyStoreIdentifier: policyStoreId, PolicyIdentifier: policy.PolicyId}).promise();
        existingPolicies.Policies[i].Policy = policyDetails.PolicyDefinition.InlinePolicy.PolicyBody;
    }


    // Add policies to the store if they don't already exist
    for (let i = 0; i < policies.length; i++) {
        const policy = policies[i];
        const policyExists = existingPolicies.Policies.find(p => p.Policy === policy);
        if (policyExists) {
            console.log('Policy already exists: ' + policy);
        } else {
            console.log('Adding policy: ' + policy);
            const newPolicy = await client.createPolicy({PolicyStoreIdentifier: policyStoreId, PolicyDefinition: {"InlinePolicy": {"PolicyBody": policy }} }).promise();
            console.log(newPolicy);
            // Wait for the policy to be created
            await new Promise(r => setTimeout(r, 1000));
        }
    }

    // Get the list of policies in the store
    const finalPolicies = await client.listPolicies({PolicyStoreIdentifier: policyStoreId}).promise();
    console.log(finalPolicies.Policies.length + ' policies exist in the store');

  } catch (err) {
    console.log(err);
  }
})();
