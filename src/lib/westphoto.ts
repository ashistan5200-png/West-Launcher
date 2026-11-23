// "Photoshop modu" (WestPhoto) tercihi: tarayıcı deposunda tutulur, Galeri düzenleyicisi ve Ayarlar paylaşır.
export const WESTPHOTO_KEY = "west.westphoto";
export const westPhotoOn = () => { try { return localStorage.getItem(WESTPHOTO_KEY) === "1"; } catch { return false; } };
export const setWestPhotoOn = (on: boolean) => { try { localStorage.setItem(WESTPHOTO_KEY, on ? "1" : "0"); } catch { /* yok say */ } };
