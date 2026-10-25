import { FLEET_ROOM, orgRoom, roomsFor, userRoom } from './rooms';

describe('rooms', () => {
  it('names the rooms of the contract', () => {
    expect(FLEET_ROOM).toBe('fleet');
    expect(orgRoom('o-1')).toBe('org:o-1');
    expect(userRoom('u-1')).toBe('user:u-1');
  });

  it('sends an attributed entry to the fleet and its organization', () => {
    expect(roomsFor('o-1')).toEqual(['fleet', 'org:o-1']);
  });

  it('sends an entry with no organization to the fleet only (BR-36)', () => {
    expect(roomsFor(null)).toEqual(['fleet']);
  });
});
