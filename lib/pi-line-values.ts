const integerText = /^(?:[1-9]\d*)$/;
const moneyText = /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/;

export function validPiQuantity(value: unknown) {
  const text = String(value ?? "");
  const number = Number(text);
  return integerText.test(text) && Number.isSafeInteger(number) && number <= 9999999999;
}

export function validPiMoney(value: unknown) {
  const text = String(value ?? "");
  const number = Number(text);
  return moneyText.test(text) && Number.isFinite(number) && number < 1000000000000;
}

export function validPiSellingPrice(price: unknown, cost: unknown) {
  return validPiMoney(price) && validPiMoney(cost);
}
