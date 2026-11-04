// Shared by the Shop with AI panel (a client component) and the root layout (a server component): where
// the panel lives, and the head script that restores it before the first paint.

/** The owner's and checkout pages have their own job; the panel stays out of them. */
export const NOT_HERE = /^\/(owner|approve|handoff|wallet|pay\/|developers)/;
export const DOCK_OPEN_KEY = 'sayso-dock-open';

/**
 * Runs before the first paint (in the page head): a panel left open on the previous page is open from
 * the first frame, with no slide and no page resize, so moving between pages doesn't flicker.
 */
export const DOCK_RESTORE_SCRIPT = `try{if(sessionStorage.getItem('${DOCK_OPEN_KEY}')&&!/${NOT_HERE.source}/.test(location.pathname))document.documentElement.classList.add('dock-open','dock-instant')}catch(e){}`;
