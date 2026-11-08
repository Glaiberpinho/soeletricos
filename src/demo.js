const pics = {
  byd: 'https://images.unsplash.com/photo-1593941707882-a5bba14938c7?auto=format&fit=crop&w=900&q=85',
  tesla: 'https://images.unsplash.com/photo-1560958089-b8a1929?auto=format&fit=crop&w=900&q=85',
  ev: 'https://images.unsplash.com/photo-1592899677977-9c10ca588bbd?auto=format&fit=crop&w=900&q=85'
}

export const demoListings = [
  { id: 'demo1', title: 'BYD Dolphin Plus 2025', description: 'BYD Dolphin Plus, elétrico, automático, baixa quilometragem, completo. Excelente estado de conservação. Autonomia para uso urbano e rodoviário.', price: 'R$ 139.900', city: 'São Paulo - SP', photoUrls: [pics.byd], demo: true },
  { id: 'demo2', title: 'Tesla Model 3 Long Range', description: 'Tesla Model 3 Long Range, teto panorâmico, piloto automático, interior premium e grande autonomia.', price: 'R$ 289.000', city: 'Campinas - SP', photoUrls: [pics.tesla], demo: true },
  { id: 'demo3', title: 'GWM Ora 03 Skin 2024', description: 'GWM Ora 03 Skin, elétrico, muito econômico, multimídia, câmera de ré e carregador portátil.', price: 'R$ 119.900', city: 'Belo Horizonte - MG', photoUrls: [pics.ev], demo: true },
  { id: 'demo4', title: 'Volvo EX30 Ultra 2025', description: 'SUV elétrico premium, tecnologia avançada, teto panorâmico e pacote completo de segurança.', price: 'R$ 239.900', city: 'Rio de Janeiro - RJ', photoUrls: [pics.tesla], demo: true },
  { id: 'demo5', title: 'BYD Seal Premium', description: 'Sedã elétrico de alto desempenho, interior sofisticado, excelente autonomia e carregamento rápido.', price: 'R$ 239.000', city: 'Curitiba - PR', photoUrls: [pics.byd], demo: true },
  { id: 'demo6', title: 'Renault Kwid E-Tech 2024', description: 'Compacto 100% elétrico, ideal para cidade, econômico e fácil de estacionar.', price: 'R$ 89.900', city: 'Brasília - DF', photoUrls: [pics.ev], demo: true }
]