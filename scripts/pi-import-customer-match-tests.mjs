import assert from 'node:assert/strict';
import { uniqueImportedPiCustomer } from '../lib/pi-import-customer-match.ts';

const source = { delivery_company: 'Example Ltd', delivery_recipient: 'J. Buyer', delivery_phone: '+44 123 456', customer_tax_number: '' };
const owned = { id: 'owned', company_name: 'Example Ltd', contact_name: 'J. Buyer', phone: '+44123456' };
assert.equal(uniqueImportedPiCustomer([owned], source)?.id, 'owned');
assert.equal(uniqueImportedPiCustomer([{ ...owned, phone: '+44123457' }], source), null, '电话不符不能自动关联');
assert.equal(uniqueImportedPiCustomer([{ ...owned, company_name: 'Other Ltd' }], source), null, '公司名不符不能自动关联');
assert.equal(uniqueImportedPiCustomer([owned, { ...owned, id: 'duplicate' }], source), null, '多个候选人须人工核对');
assert.equal(uniqueImportedPiCustomer([], source), null, '不在所选销售员名下不能自动关联');
assert.equal(uniqueImportedPiCustomer([{ ...owned, contact_name: 'Owner', phone: '0', shipping_contact_entries: [{ recipient: 'J. Buyer', phone: '+44 123 456' }] }], source)?.id, 'owned', '已保存的客户收货联系人可用于精确匹配');
assert.equal(uniqueImportedPiCustomer([owned], { ...source, delivery_company: '', customer_tax_number: '' })?.id, 'owned', '未填公司名可凭收货人和电话精确匹配');
console.log('pi import customer ownership matching passed');
