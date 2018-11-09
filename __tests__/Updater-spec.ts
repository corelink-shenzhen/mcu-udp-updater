import { Updater } from '../src';

/*
 * @Author: Yu Chen 
 * @Date: 2018-11-05 17:44:41 
 * @Last Modified by: Yu Chen
 * @Last Modified time: 2018-11-05 17:51:30
 */

class McuUpdater extends Updater {
  protected pack(ab: ArrayBuffer): ArrayBuffer {
    throw new Error('Method not implemented.');
  }
}

test('Test Updater', () => {
  expect(true).toBe(true);
});
