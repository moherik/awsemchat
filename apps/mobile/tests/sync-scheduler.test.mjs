import test from 'node:test';
import assert from 'node:assert/strict';
import * as scheduler from '../src/features/messages/sync-scheduler.ts';
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
function clock(){let queued;return {schedule:(job,delay)=>{queued={job,delay};return ()=>{queued=undefined;};},pending:()=>queued,tick:()=>{const job=queued.job;queued=undefined;job();}};}
test('foreground scheduler starts enabled and cancels pending work on pause',async()=>{
 assert.equal(typeof scheduler.createSyncScheduler,'function');const time=clock();let enabled=false,calls=0;
 const worker=scheduler.createSyncScheduler(()=>enabled,async()=>{calls++;return {more:false};},time.schedule);
 worker.refresh();assert.equal(time.pending(),undefined);
 enabled=true;worker.refresh();assert.equal(time.pending().delay,0);time.tick();await flush();assert.equal(calls,1);assert.equal(time.pending().delay,5000);
 enabled=false;worker.refresh();assert.equal(time.pending(),undefined);worker.dispose();
});
test('scheduler drains backlog immediately and retries network failure with delay',async()=>{
 assert.equal(typeof scheduler.createSyncScheduler,'function');const time=clock();let calls=0;
 const worker=scheduler.createSyncScheduler(()=>true,async()=>{calls++;if(calls===1)return {more:true};throw new Error('network');},time.schedule);
 worker.refresh();time.tick();await flush();assert.equal(time.pending().delay,0);time.tick();await flush();assert.equal(time.pending().delay,10000);worker.dispose();assert.equal(time.pending(),undefined);
});
test('pause during active synchronization prevents rescheduling',async()=>{
 assert.equal(typeof scheduler.createSyncScheduler,'function');const time=clock();let enabled=true,release;
 const gate=new Promise(resolve=>release=resolve);const worker=scheduler.createSyncScheduler(()=>enabled,async()=>{await gate;return {more:true};},time.schedule);
 worker.refresh();time.tick();enabled=false;worker.refresh();release();await flush();assert.equal(time.pending(),undefined);
});
