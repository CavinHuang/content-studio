'use client';
import {forwardRef,useEffect,useImperativeHandle,useRef} from 'react';
import {Compartment,EditorState} from '@codemirror/state';
import {Decoration,EditorView,WidgetType,highlightActiveLine} from '@codemirror/view';
import {markdownSetup} from '../vendor/doocs/shared/src/editor/markdown';
import {applyHeading,formatBold,formatItalic,formatLink,undoAction,redoAction} from '../vendor/doocs/shared/src/editor/format';

class SuggestionWidget extends WidgetType{
 constructor(s,callbacks){super();this.s=s;this.callbacks=callbacks}
 eq(other){return other.s.id===this.s.id}
 toDOM(){
  const wrap=document.createElement('span');wrap.className='writing-inline-suggestion';
  const label=document.createElement('strong');label.textContent='AI 修改建议';wrap.append(label);
  const text=document.createElement('span');text.className='writing-replacement';text.textContent=this.s.replacement;wrap.append(text);
  for(const [title,action] of [['接受修改','accept'],['拒绝','reject']]){
   const button=document.createElement('button');button.type='button';button.textContent=title;
   button.onclick=()=>this.callbacks.current.onDecision?.(this.s,action);wrap.append(button);
  }
  return wrap;
 }
 ignoreEvent(){return true}
}

const DoocsEditor=forwardRef(function DoocsEditor({value,onChange,onSelection,suggestion,onDecision,readOnly=false},ref){
 const host=useRef(null),view=useRef(null),callbacks=useRef({});
 const decorations=useRef(new Compartment()),editable=useRef(new Compartment());
 callbacks.current={onChange,onSelection,onDecision,readOnly};
 useImperativeHandle(ref,()=>({
  selection(){const v=view.current,s=v?.state.selection.main;return s?{from:s.from,to:s.to,text:v.state.doc.sliceString(s.from,s.to)}:null},
  insert(text){const v=view.current;if(v&&!callbacks.current.readOnly){const position=v.state.selection.main.to;v.dispatch({changes:{from:position,insert:text},selection:{anchor:position+text.length}});v.focus()}},
  focus(){view.current?.focus()},
  // P2-02 大纲真跳转：把折叠 selection 锚到目标行行首（不产生选中文本）、
  // 滚动到可见并聚焦；行号超界时收敛到首/末行，不影响既有回调。
  revealLine(line){const v=view.current;if(!v)return;const total=v.state.doc.lines;const target=v.state.doc.line(Math.min(Math.max(1,line),total)).from;v.dispatch({selection:{anchor:target},scrollIntoView:true});v.focus()},
 }),[]);
 useEffect(()=>{
  const instance=new EditorView({parent:host.current,state:EditorState.create({doc:value,extensions:[
   markdownSetup({placeholder:'从一个想法开始写，或与右侧助手一起生成初稿…'}),
   highlightActiveLine(), // P2-02：.cm-activeLine 供大纲 active 断言/视觉跟随
   EditorView.contentAttributes.of({'aria-label':'文章 Markdown 正文',spellcheck:'false'}),
   EditorView.theme({'&':{height:'100%'},'.cm-scroller':{overflow:'auto',fontFamily:'ui-monospace, SFMono-Regular, monospace',fontSize:'15px',lineHeight:'1.9'},'.cm-content':{padding:'28px'},'&.cm-focused':{outline:'none'}}),
   decorations.current.of(EditorView.decorations.of(Decoration.none)),
   editable.current.of(EditorState.readOnly.of(readOnly)),
   EditorView.updateListener.of(update=>{
    if(update.docChanged)callbacks.current.onChange?.(update.state.doc.toString());
    if(update.selectionSet||update.docChanged){const s=update.state.selection.main;callbacks.current.onSelection?.({from:s.from,to:s.to,text:update.state.doc.sliceString(s.from,s.to)})}
   }),
  ]})});view.current=instance;
  return()=>{instance.destroy();view.current=null};
 },[]);
 useEffect(()=>{const v=view.current;if(v&&v.state.doc.toString()!==value)v.dispatch({changes:{from:0,to:v.state.doc.length,insert:value}})},[value]);
 useEffect(()=>{view.current?.dispatch({effects:editable.current.reconfigure(EditorState.readOnly.of(readOnly))})},[readOnly]);
 useEffect(()=>{
  const v=view.current;if(!v)return;const ranges=[];
  if(suggestion&&suggestion.to<=v.state.doc.length){
   if(suggestion.from!==suggestion.to)ranges.push(Decoration.mark({class:'writing-original'}).range(suggestion.from,suggestion.to));
   ranges.push(Decoration.widget({widget:new SuggestionWidget(suggestion,callbacks),side:1}).range(suggestion.to));
  }
  v.dispatch({effects:decorations.current.reconfigure(EditorView.decorations.of(Decoration.set(ranges,true)))});
 },[suggestion]);
 function format(fn){const v=view.current;if(v&&!readOnly){fn(v);v.focus()}}
 return <div className="writing-editor-shell"><div className="writing-format" aria-label="文本格式">
  <button type="button" onClick={()=>format(v=>applyHeading(v,2))}>标题</button>
  <button type="button" onClick={()=>format(formatBold)}><b>加粗</b></button>
  <button type="button" onClick={()=>format(formatItalic)}><i>斜体</i></button>
  <button type="button" onClick={()=>format(formatLink)}>链接</button>
  <button type="button" onClick={()=>format(undoAction)}>撤销</button>
  <button type="button" onClick={()=>format(redoAction)}>重做</button>
  <span>doocs/md</span>
 </div><div className="writing-editor-host" ref={host}/></div>;
});
export default DoocsEditor;
