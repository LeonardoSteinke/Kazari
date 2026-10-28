import { Children, isValidElement, ReactNode, SelectHTMLAttributes, useEffect, useId, useRef, useState } from 'react';

type Props=Omit<SelectHTMLAttributes<HTMLSelectElement>,'onChange'|'multiple'|'size'>&{onChange?:(event:{target:{value:string}})=>void};
export function Select({children,value,defaultValue,onChange,className='',disabled,id,...props}:Props){
 const [open,setOpen]=useState(false);const [internal,setInternal]=useState(String(defaultValue??''));const root=useRef<HTMLDivElement>(null);const button=useRef<HTMLButtonElement>(null);const generated=useId();const listId=`select-${generated}`;
 const options:{value:string;label:ReactNode;disabled:boolean}[]=[];
 function collect(nodes:ReactNode){Children.forEach(nodes,node=>{if(!isValidElement<{value?:string|number;children?:ReactNode;disabled?:boolean}>(node))return;if(node.type==='option')options.push({value:String(node.props.value??node.props.children??''),label:node.props.children,disabled:!!node.props.disabled});else collect(node.props.children);});}collect(children);
 const selected=String(value??internal);const current=options.find(option=>option.value===selected)||options[0];
 useEffect(()=>{if(open)root.current?.querySelector<HTMLButtonElement>('[role="option"][aria-selected="true"]:not(:disabled), [role="option"]:not(:disabled)')?.focus({preventScroll:true});},[open]);
 useEffect(()=>{if(!open)return;const outside=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node))setOpen(false);};document.addEventListener('pointerdown',outside);return()=>document.removeEventListener('pointerdown',outside);},[open]);
 function choose(next:string){setInternal(next);onChange?.({target:{value:next}});setOpen(false);button.current?.focus({preventScroll:true});}
 return <div ref={root} className={`kazari-select ${className}`} onKeyDown={event=>{if(event.key==='Escape'&&open){event.preventDefault();event.stopPropagation();setOpen(false);button.current?.focus();}if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();setOpen(true);const buttons=Array.from(root.current?.querySelectorAll<HTMLButtonElement>('[role="option"]')||[]);const index=buttons.indexOf(document.activeElement as HTMLButtonElement);buttons[(index+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus();}}}>
 <button ref={button} type="button" id={id} className="select-trigger" disabled={disabled} aria-label={props['aria-label']} aria-haspopup="listbox" aria-expanded={open} aria-controls={open?listId:undefined} onClick={()=>setOpen(previous=>!previous)}><span>{current?.label||'Selecione'}</span><span aria-hidden="true">⌄</span></button>
 {open&&<div id={listId} className="select-options" role="listbox" aria-label={props['aria-label']||'Opções'}>{options.map((option,index)=><button key={`${option.value}:${index}`} type="button" role="option" aria-selected={selected===option.value} disabled={option.disabled} onClick={()=>choose(option.value)}><span>{option.label}</span>{selected===option.value&&<span aria-hidden="true">✓</span>}</button>)}</div>}
 </div>;
}
