/** Deterministic matching against the caller's already-authorized vendor roster only. */
const ignored = new Set(['the','a','an','can','could','would','you','me','for','with','go','please','use','choose','select','hire','send','to','my','our','vendor','contractor','company','inc','llc','ltd','test'])
function words(value: string): string[] {
  return [...new Set(value.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
    .replace(/[^a-z0-9]+/g,' ').split(/\s+/).filter(word => word && !ignored.has(word)))]
}
function distance(a: string, b: string): number {
  const rows = Array.from({length:a.length+1},()=>Array<number>(b.length+1).fill(0))
  for(let i=0;i<=a.length;i++) rows[i][0]=i
  for(let j=0;j<=b.length;j++) rows[0][j]=j
  for(let i=1;i<=a.length;i++) for(let j=1;j<=b.length;j++) {
    rows[i][j]=Math.min(rows[i-1][j]+1,rows[i][j-1]+1,rows[i-1][j-1]+(a[i-1]===b[j-1]?0:1))
    if(i>1&&j>1&&a[i-1]===b[j-2]&&a[i-2]===b[j-1]) rows[i][j]=Math.min(rows[i][j],rows[i-2][j-2]+1)
  }
  return rows[a.length][b.length]
}
export function matchHomeCheckVendorNames<T extends {id:string;name:string}>(input:string, vendors:readonly T[]):T[] {
  if(input.length>160 || /\b(?:not|except|never|don['’]?t)\b/i.test(input)) return []
  const query=words(input)
  if(!query.length || query.length>12) return []
  return vendors.filter(vendor=>{
    const name=words(vendor.name)
    if(!name.length) return false
    const unused=new Set(name.map((_,i)=>i))
    for(const token of query) {
      let best=-1,bestCost=Infinity
      for(const index of unused) {
        const word=name[index]
        // Numbers and short names must match exactly; no fuzzy phone/id routing.
        const allowed=/\d/.test(token+word)||Math.min(token.length,word.length)<4?0:Math.min(token.length,word.length)>=7?2:1
        const cost=distance(token,word)
        if(cost<=allowed&&cost<bestCost){best=index;bestCost=cost}
      }
      if(best<0) return false
      unused.delete(best)
    }
    // A partial distinctive name can yield several choices; never pick the first.
    return true
  })
}
