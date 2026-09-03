const INTERACTIVE_SELECTOR = "a,button,input,select,textarea,label,[role='button'],[contenteditable='true']";

/** Prevent row navigation from hijacking links, controls, or text editing. */
export function canOpenListRow(target: EventTarget | null) {
  return target instanceof Element && !target.closest(INTERACTIVE_SELECTOR);
}
