'use client';
import {useEffect,useState} from 'react';
import {renderDoocs} from '../lib/doocs-preview';
export default function WritingPreview({markdown,theme}){
 const [html,setHtml]=useState(''),[error,setError]=useState('');
 useEffect(()=>{try{setHtml(renderDoocs(markdown,theme));setError('')}catch{setError('预览暂时无法渲染，Markdown 正文仍可编辑和保存。')}},[markdown,theme]);
 return <section className="writing-preview" aria-label="文章排版预览">{error?<p role="status">{error}</p>:html?<div dangerouslySetInnerHTML={{__html:html}}/>:<p className="writing-empty">文章将在这里呈现。</p>}</section>;
}
