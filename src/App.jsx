import { useEffect, useMemo, useState } from 'react'
import {
  Search, CarFront, Plus, UserRound, LogOut, ChevronLeft, ChevronRight,
  X, Mail, Upload, Zap, MapPin, Trash2, ArrowLeft
} from 'lucide-react'
import { demoListings } from './demo'
import { auth, db, firebaseReady } from './firebase'
import { signInAnonymously, onAuthStateChanged } from 'firebase/auth'
import { addDoc, collection, getDocs, query, orderBy, serverTimestamp, deleteDoc, doc } from 'firebase/firestore'

const PAGE_SIZE = 18
const KEYS = { users: 'soeletricos_users_v1', session: 'soeletricos_session_v1', listings: 'soeletricos_listings_v1', proposals: 'soeletricos_proposals_v1' }

function readStore(key, fallback) {
  try { const value = localStorage.getItem(key); return value ? JSON.parse(value) : fallback }
  catch { return fallback }
}
function writeStore(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true }
  catch (error) { console.error(error); return false }
}
async function passwordHash(value) {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('')
}
function imageToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = reject
    reader.onload = () => {
      const img = new Image()
      img.onerror = reject
      img.onload = () => {
        const max = 800 
        const scale = Math.min(1, max / Math.max(img.width, img.height))
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(img.width * scale)
        canvas.height = Math.round(img.height * scale)
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg', 0.65)) 
      }
      img.src = reader.result
    }
    reader.readAsDataURL(file)
  })
}

function AdCard({ item, onOpen }) {
  return <button className="ad-card" onClick={() => onOpen(item)}>
    <div className="ad-photo">
      <img src={item.photoUrls?.[0] || 'https://placehold.co'} alt={item.title} />
      <span className="electric-tag"><Zap size={12}/> Elétrico</span>
    </div>
    <div className="ad-info">
      <h3>{item.title}</h3>
      <strong>Confira a descrição</strong>
      <small><MapPin size={13}/> Contato direto com o anunciante</small>
    </div>
  </button>
}

function App() {
  const [user, setUser] = useState(() => readStore(KEYS.session, null))
  const [firebaseUser, setFirebaseUser] = useState(null)
  const [listings, setListings] = useState(demoListings)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState(null)
  const [modal, setModal] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [photos, setPhotos] = useState([])
  const [proposal, setProposal] = useState('')
  const [proposalEmail, setProposalEmail] = useState('')

  useEffect(() => {
    if (!firebaseReady) {
      setNotice('Firebase não configurado. Configure as variáveis de ambiente para carregar anúncios na nuvem.')
      return
    }
    const unsubscribe = onAuthStateChanged(auth, current => {
      setFirebaseUser(current)
      if (!current) signInAnonymously(auth).catch(error => {
        console.error(error)
        setNotice('Não foi possível conectar ao Firebase. Verifique se o login anônimo está ativado.')
      })
    })
    loadListings()
    return unsubscribe
  }, [])

  async function loadListings() {
    if (!firebaseReady) return
    try {
      const q = query(collection(db, 'listings'), orderBy('createdAt', 'desc'))
      const snap = await getDocs(q)
      const remote = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      setListings([...remote, ...demoListings])
    } catch (error) {
      console.error(error)
      setNotice('Não foi possível carregar os anúncios do Firebase. Verifique as regras do Firestore.')
    }
  }

  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('pt-BR')
    if (!term) return listings
    return listings.filter(item => [item.title, item.description, item.price, item.city].filter(Boolean).join(' ').toLocaleLowerCase('pt-BR').includes(term))
  }, [listings, search])
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const shown = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  function doSearch(value) { setSearch(value); setPage(1) }

  async function register() {
    if (!email.trim() || !/^\S+@\S+\.\S+$/.test(email.trim())) return setNotice('Informe um e-mail válido.')
    if (password.length < 6) return setNotice('A senha precisa ter pelo menos 6 caracteres.')
    setBusy(true)
    try {
      const users = readStore(KEYS.users, [])
      const normalizedEmail = email.trim().toLowerCase()
      if (users.some(item => item.email === normalizedEmail)) return setNotice('Este e-mail já está cadastrado neste navegador. Faça login.')
      const account = { id: `user_${Date.now()}`, email: normalizedEmail, passwordHash: await passwordHash(password) }
      if (!writeStore(KEYS.users, [...users, account])) return setNotice('Não foi possível salvar a conta.')
      const session = { uid: account.id, email: account.email }
      writeStore(KEYS.session, session); setUser(session); setModal(''); setEmail(''); setPassword('')
      setNotice('Conta criada neste navegador. Você já pode publicar anúncios!')
    } catch { setNotice('Não foi possível criar a conta neste navegador.') }
    finally { setBusy(false) }
  }

  async function login() {
    if (!email.trim() || !password) return setNotice('Informe seu e-mail e sua senha.')
    setBusy(true)
    try {
      const users = readStore(KEYS.users, [])
      const normalizedEmail = email.trim().toLowerCase()
      const account = users.find(item => item.email === normalizedEmail)
      if (!account || account.passwordHash !== await passwordHash(password)) return setNotice('E-mail ou senha incorretos.')
      const session = { uid: account.id, email: account.email }
      writeStore(KEYS.session, session); setUser(session); setModal(''); setEmail(''); setPassword('')
      setNotice('Login realizado com sucesso!')
    } catch { setNotice('Não foi possível entrar nesta conta.') }
    finally { setBusy(false) }
  }

  function logout() {
    localStorage.removeItem(KEYS.session)
    setUser(null); setNotice('Você saiu da sua conta neste navegador.')
  }

  async function publish() {
    if (!user) return setNotice('Entre ou crie uma conta para publicar anúncios.')
    if (!firebaseReady) return setNotice('Firebase não configurado.')
    if (!title.trim() || !description.trim()) return setNotice('Preencha o título e a descrição.')
    if (photos.length > 6) return setNotice('Você pode enviar no máximo 6 fotos.')
    setBusy(true)
    try {
      let firebaseUser = auth.currentUser
      if (!firebaseUser) firebaseUser = (await signInAnonymously(auth)).user
      
      const photoUrls = []
      for (const file of photos) {
        const base64Url = await imageToDataUrl(file)
        photoUrls.push(base64Url)
      }
      
      await addDoc(collection(db, 'listings'), {
        title: title.trim(), description: description.trim(), photoUrls,
        ownerUid: firebaseUser.uid, ownerEmail: user.email, createdAt: serverTimestamp()
      })
      setTitle(''); setDescription(''); setPhotos([]); setModal(''); setPage(1)
      await loadListings()
      setNotice('Anúncio publicado com sucesso de forma 100% gratuita!')
    } catch (error) {
      console.error(error)
      setNotice(`Erro ao publicar: ${error?.message || 'verifique as regras.'}`)
    } finally { setBusy(false) }
  }

  function sendProposal() {
    if (!proposal.trim() || !proposalEmail.trim()) return setNotice('Informe seu e-mail e escreva uma mensagem.')
    if (selected?.demo) return setNotice('Este é um anúncio de demonstração.')
    const proposals = readStore(KEYS.proposals, [])
    const record = { id: `proposal_${Date.now()}`, listingId: selected.id, senderEmail: proposalEmail.trim(), message: proposal.trim(), createdAt: new Date().toISOString() }
    writeStore(KEYS.proposals, [record, ...proposals])
    setProposal(''); setProposalEmail('')
    setNotice('Proposta registrada com sucesso neste navegador.')
  }

  async function removeListing(item) {
    if (item.demo || item.ownerUid !== firebaseUser?.uid) return
    if (!confirm('Excluir este anúncio?')) return
    try {
      await deleteDoc(doc(db, 'listings', item.id))
      await loadListings()
      setSelected(null); setNotice('Anúncio excluído do Firebase.')
    } catch (error) { setNotice(`Não foi possível excluir: ${error?.message}`) }
  }

  return (
    <div className="site-shell">
      <header className="header">
        <a className="brand" href="#" onClick={() => { setSelected(null); setModal('') }}>
          <span className="brand-mark"><CarFront size={25}/><Zap size={12}/></span>
          <span>SÓ<span className="brand-green">ELÉTRICOS</span><small>CLASSIFICADOS</small></span>
        </a>
        <nav>
          <button className="nav-link" onClick={() => { setSelected(null); setModal('') }}>Comprar</button>
          {user ? <button className="nav-link" onClick={() => setModal('publish')}><Plus size={16}/> Anunciar</button> : <button className="nav-link" onClick={() => setModal('auth')}><UserRound size={16}/> Entrar</button>}
          {user && <button className="nav-link muted" onClick={logout}><LogOut size={16}/> Sair</button>}
        </nav>
      </header>

      <main>
