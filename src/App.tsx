import React, { useState, useRef, useEffect } from "react";
import { Upload, Copy, Check, Image as ImageIcon, Link as LinkIcon, Trash2, Loader2, ExternalLink, AlertCircle, LogOut, User, Grid, LogIn, Mail, Lock, Github } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut, 
  onAuthStateChanged, 
  signInWithPopup,
  updateProfile,
  User as FirebaseUser
} from "firebase/auth";
import { 
  collection, 
  addDoc, 
  query, 
  where, 
  getDocs, 
  deleteDoc, 
  doc, 
  getDoc,
  orderBy,
  serverTimestamp,
  setDoc
} from "firebase/firestore";
import { 
  ref, 
  uploadBytes, 
  getDownloadURL, 
  deleteObject 
} from "firebase/storage";
import { auth, db, storage, googleProvider } from "./firebase";

interface UploadResponse {
  id?: string;
  url: string;
  filename: string;
  size: number;
}

interface ImageRecord {
  id: string;
  url: string;
  filename: string;
  size: number;
  created_at: any;
  userId: string;
}

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [view, setView] = useState<"home" | "gallery" | "login" | "signup">("home");
  
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [result, setResult] = useState<UploadResponse | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDevMode, setIsDevMode] = useState(false);
  const [userImages, setUserImages] = useState<ImageRecord[]>([]);
  const [isImagesLoading, setIsImagesLoading] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auth Form State
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setIsAuthLoading(false);
      if (currentUser && (view === "login" || view === "signup")) {
        setView("home");
      }
    });

    // Check for direct image redirect
    const params = new URLSearchParams(window.location.search);
    const imageId = params.get("id");
    if (imageId) {
      handleRedirect(imageId);
    }

    if (window.location.hostname.includes("ais-dev-") || window.location.hostname.includes("localhost")) {
      setIsDevMode(true);
    }

    return () => unsubscribe();
  }, [view]);

  const handleRedirect = async (id: string) => {
    setIsAuthLoading(true);
    try {
      const docRef = doc(db, "images", id);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        const data = docSnap.data();
        // Redirect to the actual image URL
        window.location.href = data.url;
      } else {
        setError("Image not found or has been deleted.");
        setIsAuthLoading(false);
        setView("home");
      }
    } catch (err) {
      console.error("Redirect failed", err);
      setIsAuthLoading(false);
      setView("home");
    }
  };

  const handleGoogleLogin = async () => {
    setError(null);
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const user = result.user;
      
      // Save user profile to Firestore if needed
      await setDoc(doc(db, "users", user.uid), {
        email: user.email,
        name: user.displayName,
        lastLogin: serverTimestamp()
      }, { merge: true });

      setView("home");
    } catch (err: any) {
      setError(err.message || "Failed to login with Google");
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await signInWithEmailAndPassword(auth, email, password);
      setView("home");
    } catch (err: any) {
      setError(err.message || "Invalid credentials");
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;
      
      await updateProfile(user, { displayName: name });
      
      // Save user profile to Firestore
      await setDoc(doc(db, "users", user.uid), {
        email: user.email,
        name: name,
        createdAt: serverTimestamp()
      });

      setView("home");
    } catch (err: any) {
      setError(err.message || "Signup failed");
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
    setUser(null);
    setView("home");
  };

  const fetchImages = async () => {
    if (!user) return;
    setIsImagesLoading(true);
    try {
      const q = query(
        collection(db, "images"), 
        where("userId", "==", user.uid),
        orderBy("created_at", "desc")
      );
      const querySnapshot = await getDocs(q);
      const images: ImageRecord[] = [];
      querySnapshot.forEach((doc) => {
        images.push({ id: doc.id, ...doc.data() } as ImageRecord);
      });
      setUserImages(images);
    } catch (err) {
      console.error("Failed to fetch images", err);
    } finally {
      setIsImagesLoading(false);
    }
  };

  useEffect(() => {
    if (view === "gallery" && user) {
      fetchImages();
    }
  }, [view, user]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      if (selectedFile.type.startsWith("image/")) {
        setFile(selectedFile);
        const reader = new FileReader();
        reader.onloadend = () => {
          setPreview(reader.result as string);
        };
        reader.readAsDataURL(selectedFile);
        setResult(null);
        setError(null);
      } else {
        setError("Please select an image file.");
      }
    }
  };

  const handleUpload = async () => {
    if (!file) return;
    if (!user) {
      setView("login");
      return;
    }

    setIsUploading(true);
    setError(null);

    try {
      // 1. Upload to Firebase Storage
      const filename = `${Date.now()}-${file.name}`;
      const storageRef = ref(storage, `uploads/${user.uid}/${filename}`);
      const uploadResult = await uploadBytes(storageRef, file);
      const downloadUrl = await getDownloadURL(uploadResult.ref);

      // 2. Save metadata to Firestore
      const docRef = await addDoc(collection(db, "images"), {
        userId: user.uid,
        url: downloadUrl,
        filename: filename,
        originalName: file.name,
        size: file.size,
        created_at: serverTimestamp()
      });

      setResult({
        id: docRef.id,
        url: downloadUrl,
        filename: filename,
        size: file.size
      });
    } catch (err: any) {
      setError(err.message || "Failed to upload image.");
    } finally {
      setIsUploading(false);
    }
  };

  const deleteImage = async (image: ImageRecord) => {
    if (!confirm("Are you sure you want to delete this image?")) return;
    try {
      // 1. Delete from Storage
      const storageRef = ref(storage, `uploads/${user?.uid}/${image.filename}`);
      await deleteObject(storageRef);

      // 2. Delete from Firestore
      await deleteDoc(doc(db, "images", image.id));
      
      setUserImages(userImages.filter(img => img.id !== image.id));
    } catch (err) {
      console.error("Delete failed", err);
      // Even if storage delete fails (e.g. file missing), try to delete from Firestore
      try {
        await deleteDoc(doc(db, "images", image.id));
        setUserImages(userImages.filter(img => img.id !== image.id));
      } catch (e) {
        console.error("Firestore delete failed", e);
      }
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const reset = () => {
    setFile(null);
    setPreview(null);
    setResult(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  if (isAuthLoading) {
    return (
      <div className="min-h-screen bg-[#F5F5F0] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin opacity-20" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F5F5F0] text-[#141414] font-sans selection:bg-[#5A5A40] selection:text-white">
      {/* Navigation */}
      <nav className="max-w-6xl mx-auto px-6 py-6 flex justify-between items-center">
        <div 
          onClick={() => setView("home")}
          className="cursor-pointer group flex items-center gap-3"
        >
          <div className="w-10 h-10 bg-[#141414] rounded-xl flex items-center justify-center text-white group-hover:scale-110 transition-transform">
            <ImageIcon size={20} />
          </div>
          <h1 className="text-xl font-serif italic tracking-tight">ImageHost</h1>
        </div>

        <div className="flex items-center gap-6">
          {user ? (
            <>
              <button 
                onClick={() => setView("gallery")}
                className={`text-xs uppercase tracking-widest font-bold flex items-center gap-2 transition-opacity ${view === 'gallery' ? 'opacity-100' : 'opacity-40 hover:opacity-100'}`}
              >
                <Grid size={14} />
                My Gallery
              </button>
              <div className="h-4 w-[1px] bg-[#141414]/10" />
              <div className="flex items-center gap-3">
                <div className="text-right hidden sm:block">
                  <p className="text-[10px] uppercase tracking-widest opacity-40 font-bold">Logged in as</p>
                  <p className="text-xs font-medium">{user.displayName || user.email}</p>
                </div>
                <button 
                  onClick={handleLogout}
                  className="w-10 h-10 rounded-xl border border-[#141414]/10 flex items-center justify-center hover:bg-red-50 hover:border-red-100 hover:text-red-600 transition-all"
                  title="Logout"
                >
                  <LogOut size={18} />
                </button>
              </div>
            </>
          ) : (
            <div className="flex items-center gap-4">
              <button 
                onClick={() => setView("login")}
                className="text-xs uppercase tracking-widest font-bold opacity-40 hover:opacity-100 transition-opacity"
              >
                Login
              </button>
              <button 
                onClick={() => setView("signup")}
                className="px-6 py-2.5 bg-[#141414] text-white rounded-xl text-xs uppercase tracking-widest font-bold hover:bg-[#141414]/90 transition-all"
              >
                Sign Up
              </button>
            </div>
          )}
        </div>
      </nav>

      <main className="max-w-6xl mx-auto px-6 py-12">
        <AnimatePresence mode="wait">
          {view === "home" && (
            <motion.div 
              key="home"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="grid grid-cols-1 lg:grid-cols-12 gap-16"
            >
              {/* Left Side: Upload */}
              <div className="lg:col-span-7 space-y-12">
                <header>
                  <h2 className="text-5xl font-serif italic leading-tight mb-4">
                    Host your images <br />
                    <span className="text-[#5A5A40]">permanently.</span>
                  </h2>
                  <p className="text-lg opacity-60 max-w-md">
                    A professional-grade image hosting system powered by Firebase.
                  </p>
                </header>

                <div className="space-y-8">
                  <div 
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      const droppedFile = e.dataTransfer.files?.[0];
                      if (droppedFile?.type.startsWith("image/")) {
                        setFile(droppedFile);
                        const reader = new FileReader();
                        reader.onloadend = () => setPreview(reader.result as string);
                        reader.readAsDataURL(droppedFile);
                      }
                    }}
                    onClick={() => !isUploading && fileInputRef.current?.click()}
                    className={`
                      relative aspect-[16/9] rounded-[2.5rem] border-2 border-dashed transition-all duration-700 cursor-pointer overflow-hidden group
                      ${preview ? 'border-transparent' : 'border-[#141414]/10 hover:border-[#141414]/30 bg-white/50'}
                    `}
                  >
                    <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" accept="image/*" />
                    
                    {preview ? (
                      <div className="w-full h-full relative">
                        <img src={preview} alt="Preview" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center backdrop-blur-sm">
                          <p className="text-white text-sm font-bold uppercase tracking-widest">Change Image</p>
                        </div>
                      </div>
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center p-12 text-center">
                        <div className="w-20 h-20 rounded-3xl bg-[#141414]/5 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                          <Upload className="w-8 h-8 opacity-20" />
                        </div>
                        <p className="text-2xl font-serif italic mb-2">Drop your image here</p>
                        <p className="text-xs opacity-40 uppercase tracking-widest">or click to browse files</p>
                      </div>
                    )}
                  </div>

                  <div className="flex gap-4">
                    <button
                      onClick={handleUpload}
                      disabled={!file || isUploading || !!result}
                      className={`
                        flex-1 py-5 rounded-2xl font-bold uppercase tracking-widest text-xs transition-all flex items-center justify-center gap-3
                        ${!file || isUploading || !!result 
                          ? 'bg-[#141414]/5 text-[#141414]/20 cursor-not-allowed' 
                          : 'bg-[#141414] text-white hover:bg-[#141414]/90 shadow-xl shadow-black/10 active:scale-[0.98]'}
                      `}
                    >
                      {isUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImageIcon className="w-4 h-4" />}
                      {isUploading ? "Uploading..." : result ? "Uploaded Successfully" : "Generate Permanent URL"}
                    </button>
                    
                    {file && !isUploading && (
                      <button
                        onClick={reset}
                        className="w-16 h-16 rounded-2xl border border-[#141414]/10 flex items-center justify-center hover:bg-white hover:text-red-600 transition-all"
                      >
                        <Trash2 size={20} />
                      </button>
                    )}
                  </div>
                  {error && <p className="text-red-500 text-xs font-bold text-center">{error}</p>}
                </div>
              </div>

              {/* Right Side: Result or Info */}
              <div className="lg:col-span-5">
                {result ? (
                  <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-8">
                    <div className="bg-white rounded-[2rem] p-10 shadow-xl shadow-black/5 border border-[#141414]/5 space-y-8">
                      <div className="space-y-6">
                        <div className="space-y-4">
                          <div className="flex justify-between items-center">
                            <label className="text-[10px] uppercase tracking-[0.2em] font-bold opacity-40">Shareable Link (Hosted)</label>
                            {copied && <span className="text-[10px] text-emerald-600 font-bold uppercase tracking-widest">Copied!</span>}
                          </div>
                          <div className="relative group">
                            <div className="w-full bg-[#F5F5F0] rounded-2xl p-5 pr-14 text-[11px] font-mono break-all leading-relaxed">
                              {`${window.location.origin}/?id=${result.id}`}
                            </div>
                            <button 
                              onClick={() => copyToClipboard(`${window.location.origin}/?id=${result.id}`)}
                              className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-xl hover:bg-white transition-colors flex items-center justify-center"
                            >
                              <Copy size={16} className="opacity-40" />
                            </button>
                          </div>
                        </div>

                        <div className="space-y-4">
                          <div className="flex justify-between items-center">
                            <label className="text-[10px] uppercase tracking-[0.2em] font-bold opacity-40">Direct Firebase URL</label>
                          </div>
                          <div className="relative group">
                            <div className="w-full bg-[#F5F5F0]/50 rounded-2xl p-5 pr-14 text-[11px] font-mono break-all leading-relaxed opacity-60">
                              {result.url}
                            </div>
                            <button 
                              onClick={() => copyToClipboard(result.url)}
                              className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-xl hover:bg-white transition-colors flex items-center justify-center"
                            >
                              <Copy size={16} className="opacity-40" />
                            </button>
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-8 pt-4 border-t border-[#141414]/5">
                        <div>
                          <p className="text-[10px] uppercase tracking-[0.2em] font-bold opacity-40 mb-1">File Size</p>
                          <p className="text-sm font-bold">{(result.size / 1024 / 1024).toFixed(2)} MB</p>
                        </div>
                        <div>
                          <p className="text-[10px] uppercase tracking-[0.2em] font-bold opacity-40 mb-1">Status</p>
                          <p className="text-sm font-bold text-emerald-600">Active & Public</p>
                        </div>
                      </div>

                      <div className="flex gap-4 pt-4">
                        <a 
                          href={result.url} target="_blank" rel="noopener noreferrer"
                          className="flex-1 py-4 bg-[#5A5A40] text-white rounded-2xl text-[10px] font-bold uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-[#5A5A40]/90 transition-all"
                        >
                          <ExternalLink size={14} />
                          View Image
                        </a>
                      </div>
                    </div>

                    <div className="bg-[#141414] text-white rounded-[2rem] p-8 space-y-6">
                      <h3 className="text-xs uppercase tracking-[0.2em] font-bold opacity-40">Integration Guide</h3>
                      <div className="space-y-4">
                        <div className="space-y-2">
                          <p className="text-[10px] font-bold uppercase tracking-widest text-[#5A5A40]">HTML Snippet</p>
                          <div className="bg-white/5 p-4 rounded-xl text-[10px] font-mono opacity-80 break-all">
                            {`<img src="${window.location.origin}/?id=${result.id}" alt="Hosted Image" />`}
                          </div>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-center p-16 border border-dashed border-[#141414]/10 rounded-[2.5rem] opacity-30">
                    <ImageIcon size={48} className="mb-6 opacity-20" />
                    <p className="text-xl font-serif italic mb-2">Ready to host</p>
                    <p className="text-xs uppercase tracking-widest">Your generated URL will appear here</p>
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {view === "gallery" && (
            <motion.div 
              key="gallery"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-12"
            >
              <header className="flex justify-between items-end">
                <div>
                  <h2 className="text-5xl font-serif italic leading-tight">My Gallery</h2>
                  <p className="text-lg opacity-60 mt-2">All your uploaded images in one place.</p>
                </div>
                <button 
                  onClick={() => setView("home")}
                  className="px-8 py-4 bg-[#141414] text-white rounded-2xl text-xs font-bold uppercase tracking-widest hover:bg-[#141414]/90 transition-all"
                >
                  Upload New
                </button>
              </header>

              {isImagesLoading ? (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-8">
                  {[1,2,3,4].map(i => (
                    <div key={i} className="aspect-square bg-white rounded-3xl animate-pulse" />
                  ))}
                </div>
              ) : userImages.length > 0 ? (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-8">
                  {userImages.map((img) => (
                    <motion.div 
                      key={img.id}
                      layout
                      className="group bg-white rounded-3xl overflow-hidden shadow-sm border border-[#141414]/5 hover:shadow-xl transition-all"
                    >
                      <div className="aspect-square relative overflow-hidden">
                        <img src={img.url} alt="" className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700" referrerPolicy="no-referrer" />
                        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-3 p-4">
                          <button 
                            onClick={() => copyToClipboard(img.url)}
                            className="w-full py-2.5 bg-white text-[#141414] rounded-xl text-[10px] font-bold uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-white/90 transition-colors"
                          >
                            <Copy size={12} />
                            Copy URL
                          </button>
                          <div className="flex gap-2 w-full">
                            <a 
                              href={img.url} target="_blank" rel="noopener noreferrer"
                              className="flex-1 py-2.5 bg-white/20 text-white backdrop-blur-md rounded-xl text-[10px] font-bold uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-white/30 transition-colors"
                            >
                              <ExternalLink size={12} />
                              Open
                            </a>
                            <button 
                              onClick={() => deleteImage(img)}
                              className="w-10 h-10 bg-red-500/20 text-red-500 backdrop-blur-md rounded-xl flex items-center justify-center hover:bg-red-500 hover:text-white transition-all"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      </div>
                      <div className="p-4">
                        <p className="text-[10px] font-mono opacity-40 truncate">{img.filename}</p>
                        <p className="text-[10px] font-bold uppercase tracking-widest mt-1">{(img.size / 1024 / 1024).toFixed(2)} MB</p>
                      </div>
                    </motion.div>
                  ))}
                </div>
              ) : (
                <div className="py-32 text-center space-y-6 bg-white rounded-[3rem] border border-dashed border-[#141414]/10">
                  <div className="w-20 h-20 bg-[#141414]/5 rounded-3xl flex items-center justify-center mx-auto opacity-20">
                    <ImageIcon size={32} />
                  </div>
                  <div>
                    <p className="text-2xl font-serif italic">Your gallery is empty</p>
                    <p className="text-xs uppercase tracking-widest opacity-40 mt-2">Start by uploading your first image</p>
                  </div>
                  <button 
                    onClick={() => setView("home")}
                    className="px-8 py-4 bg-[#141414] text-white rounded-2xl text-xs font-bold uppercase tracking-widest hover:bg-[#141414]/90 transition-all"
                  >
                    Go to Upload
                  </button>
                </div>
              )}
            </motion.div>
          )}

          {(view === "login" || view === "signup") && (
            <motion.div 
              key="auth"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="max-w-md mx-auto py-12"
            >
              <div className="bg-white rounded-[2.5rem] p-12 shadow-2xl shadow-black/5 border border-[#141414]/5 space-y-10">
                <header className="text-center space-y-2">
                  <h2 className="text-3xl font-serif italic">{view === "login" ? "Welcome Back" : "Create Account"}</h2>
                  <p className="text-xs uppercase tracking-widest opacity-40">
                    {view === "login" ? "Sign in to manage your images" : "Join the professional hosting system"}
                  </p>
                </header>

                <div className="space-y-4">
                  <button 
                    onClick={handleGoogleLogin}
                    className="w-full py-4 bg-[#F5F5F0] rounded-2xl text-xs font-bold uppercase tracking-widest flex items-center justify-center gap-3 hover:bg-[#E4E4E0] transition-all"
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24">
                      <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                      <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                      <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
                      <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                    </svg>
                    Continue with Google
                  </button>
                </div>

                <div className="relative flex items-center justify-center">
                  <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-[#141414]/5"></div></div>
                  <span className="relative px-4 bg-white text-[10px] uppercase tracking-widest opacity-20 font-bold">or use email</span>
                </div>

                <form onSubmit={view === "login" ? handleLogin : handleSignup} className="space-y-6">
                  {view === "signup" && (
                    <div className="space-y-2">
                      <label className="text-[10px] uppercase tracking-widest font-bold opacity-40 ml-2">Full Name</label>
                      <div className="relative">
                        <User className="absolute left-4 top-1/2 -translate-y-1/2 opacity-20" size={16} />
                        <input 
                          type="text" required value={name} onChange={(e) => setName(e.target.value)}
                          className="w-full bg-[#F5F5F0] rounded-2xl py-4 pl-12 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]/5 transition-all"
                          placeholder="John Doe"
                        />
                      </div>
                    </div>
                  )}
                  <div className="space-y-2">
                    <label className="text-[10px] uppercase tracking-widest font-bold opacity-40 ml-2">Email Address</label>
                    <div className="relative">
                      <Mail className="absolute left-4 top-1/2 -translate-y-1/2 opacity-20" size={16} />
                      <input 
                        type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                        className="w-full bg-[#F5F5F0] rounded-2xl py-4 pl-12 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]/5 transition-all"
                        placeholder="name@example.com"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] uppercase tracking-widest font-bold opacity-40 ml-2">Password</label>
                    <div className="relative">
                      <Lock className="absolute left-4 top-1/2 -translate-y-1/2 opacity-20" size={16} />
                      <input 
                        type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
                        className="w-full bg-[#F5F5F0] rounded-2xl py-4 pl-12 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]/5 transition-all"
                        placeholder="••••••••"
                      />
                    </div>
                  </div>

                  {error && <p className="text-red-500 text-[10px] font-bold text-center uppercase tracking-widest">{error}</p>}

                  <button 
                    type="submit"
                    className="w-full py-5 bg-[#141414] text-white rounded-2xl text-xs font-bold uppercase tracking-widest hover:bg-[#141414]/90 shadow-xl shadow-black/10 transition-all"
                  >
                    {view === "login" ? "Sign In" : "Create Account"}
                  </button>
                </form>

                <footer className="text-center">
                  <button 
                    onClick={() => setView(view === "login" ? "signup" : "login")}
                    className="text-[10px] uppercase tracking-widest font-bold opacity-40 hover:opacity-100 transition-opacity"
                  >
                    {view === "login" ? "Don't have an account? Sign Up" : "Already have an account? Login"}
                  </button>
                </footer>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Footer */}
      <footer className="max-w-6xl mx-auto py-12 px-6 border-t border-[#141414]/10 flex flex-col sm:flex-row justify-between items-center gap-8">
        <div className="flex items-center gap-3 opacity-40">
          <ImageIcon size={16} />
          <p className="text-[10px] uppercase tracking-[0.3em] font-bold">© 2026 ImageHost Professional</p>
        </div>
        <div className="flex gap-12">
          <a href="#" className="text-[10px] uppercase tracking-[0.3em] font-bold opacity-40 hover:opacity-100 transition-opacity">Privacy</a>
          <a href="#" className="text-[10px] uppercase tracking-[0.3em] font-bold opacity-40 hover:opacity-100 transition-opacity">Terms</a>
          <a href="#" className="text-[10px] uppercase tracking-[0.3em] font-bold opacity-40 hover:opacity-100 transition-opacity">API Docs</a>
        </div>
      </footer>
    </div>
  );
}
