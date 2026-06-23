const { createNotification } = require('./services/notificationService');
const { readLocalNotifications, writeLocalNotifications } = require('./services/notificationStorage');

async function testLocalStorage() {
  console.log('--- Current local notifications count before test ---');
  let currentList = readLocalNotifications();
  console.log('Count:', currentList.length);

  console.log('\n--- Creating fake admin notification... ---');
  // Mock req.io as empty object to avoid crashes
  const fakeReq = { io: { emit: (event, payload) => console.log(`[Socket-Mock] Emitted event: ${event}`, payload) } };
  
  await createNotification(fakeReq, {
    isForAdmin: true,
    type: 'document_restore_request',
    title: 'Yêu cầu khôi phục tài liệu (TEST)',
    message: 'Tài liệu test_doc.pdf (Yêu cầu từ: test_user@arknote.com)'
  });

  console.log('\n--- Current local notifications count after test ---');
  let newList = readLocalNotifications();
  console.log('Count:', newList.length);
  console.log('Last notification details:', newList[0]);

  // Clean up
  console.log('\n--- Cleaning up test notification ---');
  const cleaned = newList.filter(n => !n.title.includes('(TEST)'));
  writeLocalNotifications(cleaned);
  console.log('Cleaned list count:', readLocalNotifications().length);
}

testLocalStorage();
